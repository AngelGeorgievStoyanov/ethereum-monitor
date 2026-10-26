import ScannerState from '../models/scannerState';
import {
    createScannerState,
    findScannerState,
    saveScannerState,
} from '../repositories/scannerStateRepository';
import { env } from '../config/env';
import { SCANNER_ID } from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';

export async function initializeScannerState(): Promise<ScannerState> {
    let state = await findScannerState(SCANNER_ID);
    const rescanBlock = env.rescanFromBlock;
    const validRescanBlock = rescanBlock !== undefined;

    if (state && validRescanBlock && state.lastRescanFromBlock !== rescanBlock) {
        state.lastProcessedBlock = rescanBlock - 1;
        state.lastRescanFromBlock = rescanBlock;
        await saveScannerState(state);
        console.log(`[Scanner] Rescan scheduled from block ${rescanBlock}`);
    }

    if (!state) {
        const startBlock = env.startBlock;
        let initialBlock: number;

        if (rescanBlock !== undefined) {
            initialBlock = rescanBlock;
        } else if (
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
            lastRescanFromBlock: validRescanBlock ? rescanBlock : null,
        });
    }

    console.log(`[Scanner] Started at checkpoint ${state.lastProcessedBlock}`);
    return state;
}
