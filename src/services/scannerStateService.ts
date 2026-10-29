import { findScannerState } from '../repositories/scannerStateRepository';
import type { ScannerRuntimeState } from '../types/scanner-state.types';

export async function refreshScannerState(state: ScannerRuntimeState): Promise<void> {
    const refreshedState = await findScannerState(state.id);
    if (!refreshedState) {
        throw new Error(`Scanner state "${state.id}" was not found`);
    }

    Object.assign(state, refreshedState);
}
