import { findScannerState } from '../repositories/scannerStateRepository';
import type { ScannerRuntimeState } from '../types/scanner-state.types';

let activeScannerState: ScannerRuntimeState | null = null;

export function registerScannerState(state: ScannerRuntimeState): void {
    activeScannerState = state;
}

export function updateScannerRuntimeState(updates: Partial<ScannerRuntimeState>): void {
    if (activeScannerState) Object.assign(activeScannerState, updates);
}

export async function refreshScannerState(state: ScannerRuntimeState): Promise<void> {
    const refreshedState = await findScannerState(state.id);
    if (!refreshedState) {
        throw new Error(`Scanner state "${state.id}" was not found`);
    }

    Object.assign(state, refreshedState);
    if (activeScannerState?.id === state.id) {
        Object.assign(activeScannerState, refreshedState);
    }
}
