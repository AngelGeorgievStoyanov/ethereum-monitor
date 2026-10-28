import { Op } from 'sequelize';
import ScannerState from '../models/scannerState';
import ScannerRescanJob from '../models/scannerRescanJob';
import {
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_POLL_INTERVAL_MS,
} from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { invalidateConfirmedBlockCache, processFinalizedBlocks } from './blockProcessor';
import { updateScannerCheckpoint } from '../repositories/scannerStateRepository';
import { getScannerControlState, isScannerPausePendingOrActive } from './scannerControlService';
import { isScannerLockHeld, tryAcquireScannerLock } from './scannerLockService';
import { processReorgRecovery } from './reorgRecoveryService';

let processingFinalizedBlocks = false;
let manualRescanReserved = false;

async function markInterruptedRescanJobs(): Promise<void> {
    const [count] = await ScannerRescanJob.update(
        {
            status: 'INTERRUPTED',
            error: 'Scanner ownership was lost before the rescan operation completed',
            completedAt: new Date(),
        },
        { where: { status: { [Op.in]: ['QUEUED', 'RUNNING'] } } },
    );
    if (count > 0) {
        console.warn('[Rescan] Marked ' + count + ' abandoned rescan job(s) as INTERRUPTED after acquiring scanner ownership');
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
    const txFilterService = getTxFilterService();
    let scannerStarted = false;

    async function start() {
        if (scannerStarted) return;
        scannerStarted = true;

        let state: ScannerState;

        try {
            while (!(await tryAcquireScannerLock())) {
                console.warn('[Scanner] Another replica owns the scanner lock; waiting');
                await sleep(SCANNER_POLL_INTERVAL_MS);
            }
            console.log('[Scanner] Acquired PostgreSQL advisory lock');
            await markInterruptedRescanJobs();
            state = await initializeScannerState();
        } catch (error) {
            scannerStarted = false;
            throw error;
        }

        let needsStateReload = false;
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
            const warningIntervalMs = 60_000;
            if (noProgressMs >= warningIntervalMs &&
                (lastStallWarningAt === 0 || now - lastStallWarningAt >= warningIntervalMs)) {
                console.warn(
                    `[Scanner] No checkpoint progress for ${Math.round(noProgressMs / 1000)}s; ` +
                        `checkpoint=${state.lastProcessedBlock}. Block processing may be stalled.`,
                );
                lastStallWarningAt = now;
            }
        }, 15_000);
        let waitingForFilters = txFilterService.getTxFilters().length === 0;
        let waitingForPause = false;
        if (waitingForFilters) {
            console.log('[Scanner] No active tx filters; waiting without advancing checkpoint');
        }

        while (true) {
            try {
                if (!(await isScannerLockHeld())) {
                    needsStateReload = true;
                    while (!(await tryAcquireScannerLock())) {
                        console.warn(
                            '[Scanner] Advisory lock unavailable after connection loss; waiting',
                        );
                        await sleep(SCANNER_POLL_INTERVAL_MS);
                    }
                    console.log('[Scanner] Reacquired PostgreSQL advisory lock');
                    await markInterruptedRescanJobs();
                }

                if (needsStateReload) {
                    state = await initializeScannerState();
                    waitingForFilters = txFilterService.getTxFilters().length === 0;
                    waitingForPause = false;
                    needsStateReload = false;
                }

                // Refresh from PostgreSQL on the lock owner; another replica may have changed filters.
                await txFilterService.loadTxFilters();
                const activeTxFilters = txFilterService.getTxFilters();

                if (activeTxFilters.length === 0) {
                    if (!waitingForFilters) {
                        console.log(
                            '[Scanner] No active tx filters; waiting without advancing checkpoint',
                        );
                    }
                    waitingForFilters = true;
                    waitingForPause = false;
                } else if ((await getScannerControlState()).paused) {
                    if (!waitingForPause) {
                        console.log('[Scanner] Paused; skipping finalized-block RPC polling');
                    }
                    waitingForPause = true;
                } else {
                    waitingForPause = false;
                    const finalized = await ethereumProvider.getBlock('finalized');
                    if (!finalized) throw new Error('Unable to resolve the latest finalized block');

                    if (finalized.number < state.lastProcessedBlock) {
                        const providerResults = await ethereumProvider.getFinalizedFromAllEndpoints();
                        const hasConsensus =
                            ethereumProvider.getEndpointCount() > 1 &&
                            providerResults.length === ethereumProvider.getEndpointCount() &&
                            providerResults.length > 0 &&
                            providerResults.every(
                                (result) =>
                                    result.error === null &&
                                    result.blockNumber === providerResults[0].blockNumber &&
                                    result.blockHash?.toLowerCase() === providerResults[0].blockHash?.toLowerCase(),
                            );
                        let diagnosticConsensus = 'NO';
                        if (ethereumProvider.getEndpointCount() === 1) {
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
                            `[Finalized] Regression detected: checkpoint=${state.lastProcessedBlock}, primaryFinalized=${finalized.number}; diagnosticConsensus=${diagnosticConsensus}; ${providerSummary}`,
                        );
                    }

                    if (waitingForFilters) {
                        if (!(await isScannerPausePendingOrActive())) {
                            const activationStartBlock = Math.min(
                                ...activeTxFilters.map(
                                    (filter) => filter.activeFromBlock ?? finalized.number + 1,
                                ),
                            );
                            const activationCheckpoint = activationStartBlock - 1;
                            if (state.lastProcessedBlock < activationCheckpoint) {
                                await updateScannerCheckpoint(state.id, activationCheckpoint);
                                state.lastProcessedBlock = activationCheckpoint;
                            }
                        }
                        console.log(
                            (await isScannerPausePendingOrActive())
                                ? `[Scanner] Active filters detected while paused; preserving checkpoint ${state.lastProcessedBlock}`
                                : `[Scanner] Active filters detected; starting at block ${state.lastProcessedBlock + 1}`,
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
                            () => txFilterService.getTxFilters(),
                        );
                        if (recoveryHandled) {
                            // Recovery can roll the checkpoint back and later replace its canonical hash.
                            invalidateConfirmedBlockCache();
                        } else {
                            await processFinalizedBlocks(state, finalizedCatchupTarget, () =>
                                txFilterService.getTxFilters(),
                            );
                        }
                    } finally {
                        processingFinalizedBlocks = false;
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
