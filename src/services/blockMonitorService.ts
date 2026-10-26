import ScannerState from '../models/scannerState';
import { SCANNER_ID, SCANNER_POLL_INTERVAL_MS } from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { initializeScannerState } from './scannerInitializationService';
import { catchUpToFinalizedBlock } from './blockCatchupService';
import { updateScannerCheckpoint } from '../repositories/scannerStateRepository';

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

        while (true) {
            try {
                const finalized = await ethereumProvider.getBlock('finalized');
                if (!finalized) throw new Error('Unable to resolve the latest finalized block');

                const activeTxFilters = txFilterService.getTxFilters();

                if (activeTxFilters.length === 0) {
                    if (state.lastProcessedBlock < finalized.number) {
                        await updateScannerCheckpoint(state.id, finalized.number);
                        state.lastProcessedBlock = finalized.number;
                        console.log(
                            `[Scanner] No active tx filters; checkpoint advanced to ${finalized.number}`,
                        );
                    }
                } else {
                    await catchUpToFinalizedBlock(state, finalized.number, activeTxFilters);
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
