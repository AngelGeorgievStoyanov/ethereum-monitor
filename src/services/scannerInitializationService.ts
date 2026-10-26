import ScannerState from '../models/scannerState';
import {
    createScannerState,
    findScannerState,
} from '../repositories/scannerStateRepository';
import { env } from '../config/env';
import { SCANNER_ID } from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';

export async function initializeScannerState(): Promise<ScannerState> {
    let state = await findScannerState(SCANNER_ID);

    if (!state) {
        const startBlock = env.startBlock;
        let initialBlock: number;

        if (
            startBlock !== undefined &&
            Number.isSafeInteger(startBlock) &&
            startBlock >= 0
        ) {
            initialBlock = startBlock;
        } else {
            const finalized = await ethereumProvider.getBlock('finalized');
            if (!finalized) throw new Error('Unable to resolve the latest finalized block');
            initialBlock = finalized.number;
        }

        state = await createScannerState({
            id: SCANNER_ID,
            lastProcessedBlock: initialBlock - 1,
            lastRescanFromBlock: null,
        });
    }

    console.log(`[Scanner] Started at checkpoint ${state.lastProcessedBlock}`);
    return state;
}
