import ScannerState from '../models/scannerState';
import { SCANNER_POLL_INTERVAL_MS } from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { processFinalizedBlocks } from './blockProcessor';
import { updateScannerCheckpoint } from '../repositories/scannerStateRepository';
import { getScannerControlState, isScannerPausePendingOrActive } from './scannerControlService';
import { isScannerLockHeld, tryAcquireScannerLock } from './scannerLockService';
import { processReorgRecovery } from './reorgRecoveryService';

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
            state = await initializeScannerState();
        } catch (error) {
            scannerStarted = false;
            throw error;
        }

        let needsStateReload = false;
        let processingFinalizedBlocks = false;
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
                }

                if (needsStateReload) {
                    state = await initializeScannerState();
                    waitingForFilters = txFilterService.getTxFilters().length === 0;
                    waitingForPause = false;
                    needsStateReload = false;
                }

                const activeTxFilters = txFilterService.getTxFilters();

                if (activeTxFilters.length === 0) {
                    if (!waitingForFilters) {
                        console.log(
                            '[Scanner] No active tx filters; waiting without advancing checkpoint',
                        );
                    }
                    waitingForFilters = true;
                    waitingForPause = false;
                } else if (getScannerControlState().paused) {
                    if (!waitingForPause) {
                        console.log('[Scanner] Paused; skipping finalized-block RPC polling');
                    }
                    waitingForPause = true;
                } else {
                    waitingForPause = false;
                    const finalized = await ethereumProvider.getBlock('finalized');
                    if (!finalized) throw new Error('Unable to resolve the latest finalized block');

                    if (waitingForFilters) {
                        if (!isScannerPausePendingOrActive()) {
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
                            isScannerPausePendingOrActive()
                                ? `[Scanner] Active filters detected while paused; preserving checkpoint ${state.lastProcessedBlock}`
                                : `[Scanner] Active filters detected; starting at block ${state.lastProcessedBlock + 1}`,
                        );
                        waitingForFilters = false;
                    }

                    const recoveryHandled = await processReorgRecovery(
                        state,
                        finalized.number,
                        () => txFilterService.getTxFilters(),
                    );
                    if (!recoveryHandled) {
                        processingFinalizedBlocks = state.lastProcessedBlock < finalized.number;
                        if (processingFinalizedBlocks) {
                            lastObservedCheckpoint = state.lastProcessedBlock;
                            lastProgressAt = Date.now();
                            lastStallWarningAt = 0;
                        }
                        try {
                            await processFinalizedBlocks(state, finalized.number, () =>
                                txFilterService.getTxFilters(),
                            );
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
