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

export function createBlockMonitorService() {
    const txFilterService = getTxFilterService();
    let scannerStarted = false;

    async function start() {
        if (scannerStarted) return;
        scannerStarted = true;

        let state: ScannerState;

        try {
            state = await initializeScannerState();
        } catch (error) {
            scannerStarted = false;
            throw error;
        }

        let waitingForFilters = txFilterService.getTxFilters().length === 0;
        let waitingForPause = false;
        if (waitingForFilters) {
            console.log('[Scanner] No active tx filters; waiting without advancing checkpoint');
        }

        while (true) {
            try {
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

                    await processFinalizedBlocks(state, finalized.number, () =>
                        txFilterService.getTxFilters(),
                    );
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
