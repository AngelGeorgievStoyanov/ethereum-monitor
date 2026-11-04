import type { ScannerRuntimeState } from '../types/scanner-state.types';
import {
    SCANNER_STALL_CHECK_INTERVAL_MS,
    SCANNER_STALL_WARNING_INTERVAL_MS,
    FINALIZED_REGRESSION_WAIT_MS,
} from '../constants/scanner.constants';
import { evmRpcClient } from './evmBlockDataService';
import { getDynamicConfigService } from './dynamicConfigService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { registerScannerState } from './scannerStateService';
import { processFinalizedBlocks } from './blockProcessor';

import { markActiveScannerRescanJobsInterrupted } from '../repositories/scannerRescanJobRepository';
import { refreshScannerStatusSnapshot } from './scannerStatusService';
import { processReorgRecovery } from './reorgRecoveryService';
import { recordFinalizedBlock, recordFinalizedBlockFailure, updateScannerRuntimeContext } from './metricsAggregatorService';

let processingFinalizedBlocks = false;
let manualRescanReserved = false;

async function markInterruptedRescanJobs(): Promise<void> {
    const count = await markActiveScannerRescanJobsInterrupted();
    if (count > 0) {
        console.warn(
            '[Rescan] Marked ' +
                count +
                ' abandoned rescan job(s) as INTERRUPTED after process restart',
        );
    }
}

export function isScannerProcessingBlocks(): boolean {
    return processingFinalizedBlocks;
}

export function tryReserveManualRescan(): boolean {
    if (processingFinalizedBlocks || manualRescanReserved) return false;
    manualRescanReserved = true;
    return true;
}

export function releaseManualRescanReservation(): void {
    manualRescanReserved = false;
}

export function createBlockMonitorService() {
    const dynamicConfigService = getDynamicConfigService();
    let scannerStarted = false;

    async function start() {
        if (scannerStarted) return;
        scannerStarted = true;

        let state: ScannerRuntimeState;

        try {
            await markInterruptedRescanJobs();
            state = await initializeScannerState();
            registerScannerState(state);
            await refreshScannerStatusSnapshot();
            updateScannerRuntimeContext({ running: true, lastProcessedBlock: state.lastProcessedBlock, activeFiltersCount: dynamicConfigService.getTxFilters().length, maxBlocksPerCatchup: dynamicConfigService.getDynamicSettings().scanner.maxBlocksPerCatchup, maxParallelBlocks: dynamicConfigService.getDynamicSettings().scanner.maxParallelBlocks, parallelProcessingLagBlocks: dynamicConfigService.getDynamicSettings().scanner.parallelProcessingLagBlocks });
            dynamicConfigService.updateScannerStatusSnapshot({ scannerRunning: true });
        } catch (error) {
            scannerStarted = false;
            throw error;
        }

        let lastObservedCheckpoint = state.lastProcessedBlock;
        let lastProgressAt = Date.now();
        let lastStallWarningAt = 0;
        let finalizedRegressionActive = false;

        setInterval(() => {
            if (!processingFinalizedBlocks) return;

            if (state.lastProcessedBlock !== lastObservedCheckpoint) {
                lastObservedCheckpoint = state.lastProcessedBlock;
                lastProgressAt = Date.now();
                lastStallWarningAt = 0;
                return;
            }

            const now = Date.now();
            const noProgressMs = now - lastProgressAt;
            if (
                noProgressMs >= SCANNER_STALL_WARNING_INTERVAL_MS &&
                (lastStallWarningAt === 0 ||
                    now - lastStallWarningAt >= SCANNER_STALL_WARNING_INTERVAL_MS)
            ) {
                console.warn(
                    `[Scanner] No checkpoint progress for ${Math.round(noProgressMs / 1000)}s; ` +
                        `checkpoint=${state.lastProcessedBlock}. Block processing may be stalled.`,
                );
                lastStallWarningAt = now;
            }
        }, SCANNER_STALL_CHECK_INTERVAL_MS);
        let waitingForFilters = dynamicConfigService.getTxFilters().length === 0;
        let waitingForPause = false;
        if (waitingForFilters) {
            console.log('[Scanner] No active tx filters; waiting without advancing checkpoint');
        }

        while (true) {
            try {
                // The filter cache is refreshed on startup, after local mutations, and periodically.
                const activeTxFilters = dynamicConfigService.getTxFilters();
                updateScannerRuntimeContext({ running: true, activeFiltersCount: activeTxFilters.length, lastProcessedBlock: state.lastProcessedBlock, maxBlocksPerCatchup: dynamicConfigService.getDynamicSettings().scanner.maxBlocksPerCatchup, maxParallelBlocks: dynamicConfigService.getDynamicSettings().scanner.maxParallelBlocks, parallelProcessingLagBlocks: dynamicConfigService.getDynamicSettings().scanner.parallelProcessingLagBlocks });

                if (activeTxFilters.length === 0) {
                    if (!waitingForFilters) {
                        console.log(
                            '[Scanner] No active tx filters; waiting without advancing checkpoint',
                        );
                    }
                    waitingForFilters = true;
                    waitingForPause = false;
                } else {
                    if (dynamicConfigService.getScannerControlSnapshot()) {
                        if (!waitingForPause) {
                            console.log('[Scanner] Paused; skipping finalized-block RPC polling');
                        }
                        waitingForPause = true;
                    } else {
                        waitingForPause = false;
                        if (manualRescanReserved) {
                            await sleep(dynamicConfigService.getDynamicSettings().scanner.pollIntervalMs);
                            continue;
                        }
                        let finalized: Awaited<ReturnType<typeof evmRpcClient.getBlock>>;
                        try {
                            finalized = await evmRpcClient.getBlock('finalized');
                            if (!finalized) throw new Error('Unable to resolve the latest finalized block');
                            recordFinalizedBlock(finalized.number);
                        } catch (error) {
                            recordFinalizedBlockFailure();
                            throw error;
                        }

                        if (finalized.number < state.lastProcessedBlock) {
                            const checkpoint = state.lastProcessedBlock;
                            if (!finalizedRegressionActive) {
                                console.error(
                                    `[Finalized] RPC returned a lower finalized block: finalized=${finalized.number}, checkpoint=${checkpoint} (${checkpoint - finalized.number} block(s) behind). Scanner processing is paused; checkpoint is preserved. Retrying in ${FINALIZED_REGRESSION_WAIT_MS / 1000}s to check whether the RPC returns a higher finalized block. If this persists, manual intervention and investigation may be required.`,
                                );
                                finalizedRegressionActive = true;
                            }
                            await sleep(FINALIZED_REGRESSION_WAIT_MS);
                            continue;
                        }

                        if (finalizedRegressionActive) {
                            console.log(
                                `[Finalized] Height recovered to ${finalized.number}; checkpoint=${state.lastProcessedBlock}. Normal scanner processing may resume.`,
                            );
                            finalizedRegressionActive = false;
                        }

                        if (waitingForFilters) {
                            console.log(
                                `[Scanner] Active filters detected; continuing from block ${state.lastProcessedBlock + 1}`,
                            );
                            waitingForFilters = false;
                        }

                        const finalizedCatchupTarget = Math.min(
                            finalized.number,
                            state.lastProcessedBlock + dynamicConfigService.getDynamicSettings().scanner.maxBlocksPerCatchup,
                        );
                        if (finalizedCatchupTarget < finalized.number) {
                            console.log(
                                `[Scanner] Finalized catch-up capped at ${finalizedCatchupTarget}; reportedFinalized=${finalized.number}; checkpoint=${state.lastProcessedBlock}; maxStep=${dynamicConfigService.getDynamicSettings().scanner.maxBlocksPerCatchup}`,
                            );
                        }

                        // Reserve and block normal processing atomically with respect to the rescan endpoint.
                        if (manualRescanReserved) {
                            await sleep(dynamicConfigService.getDynamicSettings().scanner.pollIntervalMs);
                            continue;
                        }
                        processingFinalizedBlocks = true;
                        lastObservedCheckpoint = state.lastProcessedBlock;
                        lastProgressAt = Date.now();
                        lastStallWarningAt = 0;
                        try {
                            const recoveryHandled = await processReorgRecovery(
                                state,
                                finalizedCatchupTarget,
                                finalized.hash ?? '',
                                () => dynamicConfigService.getTxFilterSnapshot(),
                            );
                            if (!recoveryHandled) {
                                await processFinalizedBlocks(state, finalizedCatchupTarget, () =>
                                    dynamicConfigService.getTxFilterSnapshot(),
                                );
                            }
                            updateScannerRuntimeContext({ lastProcessedBlock: state.lastProcessedBlock });
                            dynamicConfigService.updateScannerStatusSnapshot({
                                lastProcessedBlock: state.lastProcessedBlock,
                                reorgRecoveryActive: state.reorgRecoveryActive,
                                reorgRecoveryBlocked: state.reorgRecoveryBlocked,
                                reorgRecoveryBlockReason: state.reorgRecoveryBlockReason,
                                reorgRecoveryStableBlocks: state.reorgRecoveryStableBlocks,
                                reorgRecoveryStartBlock: state.reorgRecoveryStartBlock,
                                reorgRecoveryTargetBlock: state.reorgRecoveryTargetBlock,
                            });
                        } finally {
                            processingFinalizedBlocks = false;
                        }
                    }
                }
            } catch (error) {
                console.error(
                    `[Scanner] Processing failed; checkpoint=${state.lastProcessedBlock}: ${formatError(error)}`,
                );
            }

            await sleep(dynamicConfigService.getDynamicSettings().scanner.pollIntervalMs);
        }
    }

    return { start };
}
