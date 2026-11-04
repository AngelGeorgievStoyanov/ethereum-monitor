import { findScannerState } from '../repositories/scannerStateRepository';
import type { ScannerState } from '../types/scanner-state.types';

let activeScannerState: ScannerState | null = null;

export function registerScannerState(state: ScannerState): void {
    activeScannerState = state;
}

export function updateScannerState(updates: Partial<ScannerState>): void {
    if (activeScannerState) Object.assign(activeScannerState, updates);
}

export async function refreshScannerState(state: ScannerState): Promise<void> {
    const refreshedState = await findScannerState(state.id);
    if (!refreshedState) {
        throw new Error(`Scanner state "${state.id}" was not found`);
    }

    Object.assign(state, refreshedState);
    if (activeScannerState?.id === state.id) {
        Object.assign(activeScannerState, refreshedState);
    }
}
