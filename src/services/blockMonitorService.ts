import type { ScannerState } from '../types/scanner-state.types';
import {
    SCANNER_STALL_CHECK_INTERVAL_MS,
    SCANNER_STALL_WARNING_INTERVAL_MS,
    FINALIZED_REGRESSION_WAIT_MS,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_POLL_INTERVAL_MS,
} from '../constants/scanner.constants';
import { evmRpcClient } from './evmBlockDataService';
import { getDynamicConfigService } from './dynamicConfigService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { registerScannerState } from './scannerStateService';
import { processFinalizedBlocks } from './blockProcessor';

import { markActiveScannerRescanJobsInterrupted } from '../repositories/scannerRescanJobRepository';
import { refreshScannerStatus } from './scannerStatusService';
import { processReorgRecovery } from './reorgRecoveryService';
import {
    recordFinalizedBlock,
    recordFinalizedBlockFailure,
    updateScannerContext,
} from './metricsAggregatorService';

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

    function getScannerSettings() {
        const dynamicSettings = dynamicConfigService.getDynamicSettings();
        return {
            maxParallelBlocks:
                Number(dynamicSettings.maxParallelBlocks) || SCANNER_MAX_PARALLEL_BLOCKS,
            parallelProcessingLagBlocks:
                Number(dynamicSettings.parallelProcessingLagBlocks) ||
                SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
            maxBlocksPerCatchup:
                Number(dynamicSettings.maxBlocksPerCatchup) || MAX_BLOCKS_PER_FINALIZED_CATCHUP,
            pollIntervalMs: Number(dynamicSettings.pollIntervalMs) || SCANNER_POLL_INTERVAL_MS,
        };
    }

    async function start() {
        if (scannerStarted) return;
        scannerStarted = true;

        let state: ScannerState;

        try {
            await markInterruptedRescanJobs();
            state = await initializeScannerState();
            registerScannerState(state);
            await refreshScannerStatus();
            const scannerSettings = getScannerSettings();
            updateScannerContext({
                running: true,
                lastProcessedBlock: state.lastProcessedBlock,
                activeFiltersCount: dynamicConfigService.getTxFilters().length,
                maxBlocksPerCatchup: scannerSettings.maxBlocksPerCatchup,
                maxParallelBlocks: scannerSettings.maxParallelBlocks,
                parallelProcessingLagBlocks: scannerSettings.parallelProcessingLagBlocks,
            });
            dynamicConfigService.updateScannerStatus({ scannerRunning: true });
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
                const scannerSettings = getScannerSettings();
                updateScannerContext({
                    running: true,
                    activeFiltersCount: activeTxFilters.length,
                    lastProcessedBlock: state.lastProcessedBlock,
                    maxBlocksPerCatchup: scannerSettings.maxBlocksPerCatchup,
                    maxParallelBlocks: scannerSettings.maxParallelBlocks,
                    parallelProcessingLagBlocks: scannerSettings.parallelProcessingLagBlocks,
                });

                if (activeTxFilters.length === 0) {
                    if (!waitingForFilters) {
                        console.log(
                            '[Scanner] No active tx filters; waiting without advancing checkpoint',
                        );
                    }
                    waitingForFilters = true;
                    waitingForPause = false;
                } else {
                    if (dynamicConfigService.getScannerPaused()) {
                        if (!waitingForPause) {
                            console.log('[Scanner] Paused; skipping finalized-block RPC polling');
                        }
                        waitingForPause = true;
                    } else {
                        waitingForPause = false;
                        if (manualRescanReserved) {
                            await sleep(getScannerSettings().pollIntervalMs);
                            continue;
                        }
                        let finalized: Awaited<ReturnType<typeof evmRpcClient.getBlock>>;
                        try {
                            finalized = await evmRpcClient.getBlock('finalized');
                            if (!finalized)
                                throw new Error('Unable to resolve the latest finalized block');
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
                            state.lastProcessedBlock + scannerSettings.maxBlocksPerCatchup,
                        );
                        if (finalizedCatchupTarget < finalized.number) {
                            console.log(
                                `[Scanner] Finalized catch-up capped at ${finalizedCatchupTarget}; reportedFinalized=${finalized.number}; checkpoint=${state.lastProcessedBlock}; maxStep=${scannerSettings.maxBlocksPerCatchup}`,
                            );
                        }

                        // Reserve and block normal processing atomically with respect to the rescan endpoint.
                        if (manualRescanReserved) {
                            await sleep(getScannerSettings().pollIntervalMs);
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
                                () => dynamicConfigService.getActiveTxFilterConfig(),
                            );
                            if (!recoveryHandled) {
                                await processFinalizedBlocks(
                                    state,
                                    finalizedCatchupTarget,
                                    finalized.number,
                                    scannerSettings.maxBlocksPerCatchup,
                                    () => dynamicConfigService.getActiveTxFilterConfig(),
                                );
                            }
                            updateScannerContext({ lastProcessedBlock: state.lastProcessedBlock });
                            dynamicConfigService.updateScannerStatus({
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

            await sleep(getScannerSettings().pollIntervalMs);
        }
    }

    return { start };
}
