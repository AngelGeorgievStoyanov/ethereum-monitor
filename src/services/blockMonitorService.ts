import type { ScannerRuntimeState } from '../types/scanner-state.types';
import {
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
    SCANNER_POLL_INTERVAL_MS,
    SCANNER_STALL_CHECK_INTERVAL_MS,
    SCANNER_STALL_WARNING_INTERVAL_MS,
} from '../constants/scanner.constants';
import { evmRpcClient } from './evmBlockDataService';
import { getDynamicConfigService } from './dynamicConfigService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { registerScannerState } from './scannerStateService';
import { processFinalizedBlocks } from './blockProcessor';
import { invalidateConfirmedBlockCache } from './scannerCheckpointCache';
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

async function logFinalizedRegressionDiagnostics(
    checkpoint: number,
    primaryFinalized: number,
): Promise<void> {
    try {
        const providerResults = await evmRpcClient.getFinalizedFromAllEndpoints();
        const hasConsensus =
            evmRpcClient.getEndpointCount() > 1 &&
            providerResults.length === evmRpcClient.getEndpointCount() &&
            providerResults.length > 0 &&
            providerResults.every(
                (result) =>
                    result.error === null &&
                    result.blockNumber === providerResults[0].blockNumber &&
                    result.blockHash?.toLowerCase() === providerResults[0].blockHash?.toLowerCase(),
            );
        let diagnosticConsensus = 'NO';
        if (evmRpcClient.getEndpointCount() === 1) {
            diagnosticConsensus = 'NOT_APPLICABLE_SINGLE_PROVIDER';
        } else if (hasConsensus) {
            diagnosticConsensus = 'YES';
        }
        const providerSummary = providerResults
            .map((result) =>
                result.error
                    ? `P${result.endpointIndex}=ERROR(${result.error})`
                    : `P${result.endpointIndex}=${result.blockNumber}(hash=${result.blockHash})`,
            )
            .join('; ');
        console.warn(
            `[Finalized] Regression diagnostics: checkpoint=${checkpoint}, primaryFinalized=${primaryFinalized}; diagnosticConsensus=${diagnosticConsensus}; ${providerSummary}`,
        );
    } catch (error) {
        console.error(
            `[Finalized] Failed to collect non-blocking regression diagnostics: ${formatError(error)}`,
        );
    }
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
            updateScannerRuntimeContext({ running: true, lastProcessedBlock: state.lastProcessedBlock, activeFiltersCount: dynamicConfigService.getTxFilters().length, maxBlocksPerCatchup: MAX_BLOCKS_PER_FINALIZED_CATCHUP, maxParallelBlocks: SCANNER_MAX_PARALLEL_BLOCKS, parallelProcessingLagBlocks: SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS });
            dynamicConfigService.updateScannerStatusSnapshot({ scannerRunning: true });
        } catch (error) {
            scannerStarted = false;
            throw error;
        }

        let lastObservedCheckpoint = state.lastProcessedBlock;
        let lastProgressAt = Date.now();
        let lastStallWarningAt = 0;

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
                updateScannerRuntimeContext({ running: true, activeFiltersCount: activeTxFilters.length, lastProcessedBlock: state.lastProcessedBlock, maxBlocksPerCatchup: MAX_BLOCKS_PER_FINALIZED_CATCHUP, maxParallelBlocks: SCANNER_MAX_PARALLEL_BLOCKS, parallelProcessingLagBlocks: SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS });

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
                            const primaryFinalized = finalized.number;
                            console.warn(
                                `[Finalized] Regression detected: checkpoint=${checkpoint}, primaryFinalized=${primaryFinalized}; collecting non-blocking RPC diagnostics`,
                            );
                            void logFinalizedRegressionDiagnostics(checkpoint, primaryFinalized);
                        }

                        if (waitingForFilters) {
                            console.log(
                                `[Scanner] Active filters detected; continuing from block ${state.lastProcessedBlock + 1}`,
                            );
                            waitingForFilters = false;
                        }

                        const finalizedCatchupTarget = Math.min(
                            finalized.number,
                            state.lastProcessedBlock + MAX_BLOCKS_PER_FINALIZED_CATCHUP,
                        );
                        if (finalizedCatchupTarget < finalized.number) {
                            console.log(
                                `[Scanner] Finalized catch-up capped at ${finalizedCatchupTarget}; reportedFinalized=${finalized.number}; checkpoint=${state.lastProcessedBlock}; maxStep=${MAX_BLOCKS_PER_FINALIZED_CATCHUP}`,
                            );
                        }

                        // Reserve and block normal processing atomically with respect to the rescan endpoint.
                        if (manualRescanReserved) {
                            await sleep(SCANNER_POLL_INTERVAL_MS);
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
                            if (recoveryHandled) {
                                // Recovery can roll the checkpoint back and later replace its canonical hash.
                                invalidateConfirmedBlockCache();
                            } else {
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

            await sleep(SCANNER_POLL_INTERVAL_MS);
        }
    }

    return { start };
}
