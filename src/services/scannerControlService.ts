import { SCANNER_CONTROL_FAST_REFRESH_INTERVAL_MS, SCANNER_ID } from '../constants/scanner.constants';
import {
    findScannerControlRecord,
    updateScannerControlRecord,
} from '../repositories/scannerStateRepository';
import { mapScannerControlResponse, mapScannerResumeResponse } from '../mappers/scannerControlMapper';
import { updateScannerRuntimeContext } from './metricsAggregatorService';
import { getDynamicConfigService } from './dynamicConfigService';
import type { ScannerControlState } from '../types/scanner-status.types';
import { formatError } from '../utils/formatError';

let controlRefreshTimer: ReturnType<typeof setInterval> | undefined;
let controlRefreshInProgress = false;

function publishControlSnapshot(control: ScannerControlState): void {
    getDynamicConfigService().publishScannerControlSnapshot(control.paused);
    updateScannerRuntimeContext({ paused: control.paused });
}

async function loadControlSnapshot(): Promise<ScannerControlState> {
    const record = await findScannerControlRecord(SCANNER_ID);
    const control = { paused: record?.paused ?? false };
    publishControlSnapshot(control);
    return control;
}

async function refreshControlSnapshot(): Promise<void> {
    if (controlRefreshInProgress) return;
    controlRefreshInProgress = true;

    try {
        await loadControlSnapshot();
    } catch (error) {
        console.error(
            `[ScannerControl] Fast refresh failed; keeping the last successful pause state: ${formatError(error)}`,
        );
    } finally {
        controlRefreshInProgress = false;
    }
}

export async function initScannerControlRefresh(): Promise<void> {
    if (controlRefreshTimer) return;

    // Load the initial state before scheduling refreshes or starting the scanner.
    await loadControlSnapshot();

    controlRefreshTimer = setInterval(() => {
        void refreshControlSnapshot();
    }, SCANNER_CONTROL_FAST_REFRESH_INTERVAL_MS);
    controlRefreshTimer.unref?.();

    console.log(
        `[ScannerControl] Fast refresh scheduled every ${SCANNER_CONTROL_FAST_REFRESH_INTERVAL_MS}ms`,
    );
}

export function stopScannerControlRefresh(): void {
    if (!controlRefreshTimer) return;
    clearInterval(controlRefreshTimer);
    controlRefreshTimer = undefined;
}

export function getScannerControlState(): ScannerControlState {
    return { paused: getDynamicConfigService().getScannerControlSnapshot() };
}

export async function requestScannerPause(): Promise<void> {
    await updateScannerControlRecord(SCANNER_ID, { scannerPaused: true });
    console.log('[Scanner] Pause requested; it will be applied on the next control refresh');
}

export async function resumeScanner(): Promise<void> {
    await updateScannerControlRecord(SCANNER_ID, { scannerPaused: false });
    console.log('[Scanner] Resume requested; it will be applied on the next control refresh');
}

export async function requestScannerPauseResponse() {
    await requestScannerPause();
    return mapScannerControlResponse(
        'Scanner pause requested; it will be applied on the next control refresh',
        { paused: true },
    );
}

export async function resumeScannerResponse() {
    await resumeScanner();
    return mapScannerResumeResponse({ paused: false });
}
