import ScannerState from '../models/scannerState';
import { SCANNER_POLL_INTERVAL_MS } from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { catchUpToFinalizedBlock } from './blockCatchupService';
import { updateScannerCheckpoint } from '../repositories/scannerStateRepository';
import { isScannerPausePendingOrActive } from './scannerControlService';

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

        // If the process starts with active filters, preserve the checkpoint and catch up.
        // If it starts without filters, the first later activation begins at the latest
        // finalized block instead of replaying a period during which nothing was monitored.
        let waitingForFilters = txFilterService.getTxFilters().length === 0;

        if (waitingForFilters) {
            console.log('[Scanner] No active tx filters; waiting without advancing checkpoint');
        }

        while (true) {
            try {
                const finalized = await ethereumProvider.getBlock('finalized');
                if (!finalized) throw new Error('Unable to resolve the latest finalized block');

                const activeTxFilters = txFilterService.getTxFilters();

                if (activeTxFilters.length === 0) {
                    if (!waitingForFilters) {
                        console.log('[Scanner] No active tx filters; scanning paused until a filter is activated');
                    }
                    waitingForFilters = true;
                } else {
                    if (waitingForFilters) {
                        if (!isScannerPausePendingOrActive() && state.lastProcessedBlock < finalized.number) {
                            await updateScannerCheckpoint(state.id, finalized.number);
                            state.lastProcessedBlock = finalized.number;
                        }
                        console.log(
                            isScannerPausePendingOrActive()
                                ? `[Scanner] Active filters detected while paused; preserving checkpoint ${state.lastProcessedBlock}`
                                : `[Scanner] Active filters detected; starting after finalized block ${state.lastProcessedBlock}`,
                        );
                        waitingForFilters = false;
                    }

                    await catchUpToFinalizedBlock(state, finalized.number, () => txFilterService.getTxFilters());
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
