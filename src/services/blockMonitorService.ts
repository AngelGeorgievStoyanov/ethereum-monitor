import type { ScannerRuntimeState } from '../types/scanner-state.types';
import {
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
    SCANNER_POLL_INTERVAL_MS,
    SCANNER_STALL_CHECK_INTERVAL_MS,
    SCANNER_STALL_WARNING_INTERVAL_MS,
    FINALIZED_REGRESSION_DIAGNOSTIC_COOLDOWN_MS,
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

let finalizedDiagnosticsInFlight = false;
let lastFinalizedDiagnosticsAt = 0;

async function logFinalizedRegressionDiagnostics(
    checkpoint: number,
    primaryFinalized: number,
): Promise<void> {
    try {
        const providerResults = await evmRpcClient.getFinalizedFromAllEndpoints();
        const successfulResults = providerResults.filter(
            (result) => result.error === null && result.blockNumber !== null && result.blockHash !== null,
        );
        const hasConsensus =
            evmRpcClient.getEndpointCount() > 1 &&
            successfulResults.length === evmRpcClient.getEndpointCount() &&
            successfulResults.every(
                (result) =>
                    result.blockNumber === successfulResults[0].blockNumber &&
                    result.blockHash?.toLowerCase() === successfulResults[0].blockHash?.toLowerCase(),
            );
        const heights = new Set(successfulResults.map((result) => result.blockNumber));
        const hashesByHeight = new Map<number, Set<string>>();
        for (const result of successfulResults) {
            const hashes = hashesByHeight.get(result.blockNumber!) ?? new Set<string>();
            hashes.add(result.blockHash!.toLowerCase());
            hashesByHeight.set(result.blockNumber!, hashes);
        }
        const heightMismatch = heights.size > 1;
        const hashMismatch = Array.from(hashesByHeight.values()).some((hashes) => hashes.size > 1);
        const providerErrors = providerResults.filter((result) => result.error !== null);
        let diagnosticConsensus = 'NO';
        if (evmRpcClient.getEndpointCount() === 1) {
            diagnosticConsensus = 'NOT_APPLICABLE_SINGLE_PROVIDER';
        } else if (hasConsensus) {
            diagnosticConsensus = 'YES';
        }
        const providerSummary = providerResults
            .map((result) =>
                result.error
                    ? `P${result.endpointIndex}=ERROR(${result.error.slice(0, 200)})`
                    : `P${result.endpointIndex}=${result.blockNumber}(hash=${result.blockHash})`,
            )
            .join('; ');
        if (heightMismatch || hashMismatch || providerErrors.length > 0) {
            console.warn(
                `[Finalized] RPC provider disagreement: heightMismatch=${heightMismatch}, hashMismatch=${hashMismatch}, providerErrors=${providerErrors.length}; checkpoint=${checkpoint}, primaryFinalized=${primaryFinalized}; ${providerSummary}`,
            );
        } else {
            console.warn(
                `[Finalized] RPC providers agree during regression: checkpoint=${checkpoint}, primaryFinalized=${primaryFinalized}; diagnosticConsensus=${diagnosticConsensus}; ${providerSummary}`,
            );
        }
    } catch (error) {
        console.error(
            `[Finalized] Failed to collect non-blocking regression diagnostics: ${formatError(error)}`,
        );
    }
}

function scheduleFinalizedRegressionDiagnostics(
    checkpoint: number,
    primaryFinalized: number,
): void {
    const now = Date.now();
    if (
        finalizedDiagnosticsInFlight ||
        now - lastFinalizedDiagnosticsAt < FINALIZED_REGRESSION_DIAGNOSTIC_COOLDOWN_MS
    ) {
        return;
    }

    finalizedDiagnosticsInFlight = true;
    lastFinalizedDiagnosticsAt = now;
    void logFinalizedRegressionDiagnostics(checkpoint, primaryFinalized).finally(() => {
        finalizedDiagnosticsInFlight = false;
    });
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
                        if (manualRescanReserved) {
                            await sleep(SCANNER_POLL_INTERVAL_MS);
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
                                console.warn(
                                    `[Finalized] Regression detected: finalized=${finalized.number} is ${checkpoint - finalized.number} block(s) behind checkpoint=${checkpoint}; scanner processing is waiting for finalized height to recover. Checkpoint is preserved.`,
                                );
                                finalizedRegressionActive = true;
                            }
                            scheduleFinalizedRegressionDiagnostics(checkpoint, finalized.number);
                            await sleep(SCANNER_POLL_INTERVAL_MS);
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

            await sleep(SCANNER_POLL_INTERVAL_MS);
        }
    }

    return { start };
}
