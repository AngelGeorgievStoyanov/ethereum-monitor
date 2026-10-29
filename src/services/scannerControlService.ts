import ScannerState from '../models/scannerState';
import type { ScannerControlState, ScannerPauseMode } from '../types/scanner-status.types';
import { SCANNER_DEFAULT_PAUSE_DURATION_MINUTES, SCANNER_ID } from '../constants/scanner.constants';

function toControlState(state: ScannerState | null): ScannerControlState {
    return {
        paused: state?.scannerPaused ?? false,
        mode: state?.scannerPauseMode ?? null,
        pauseRequestedAtBlock: state?.scannerPauseRequestedAtBlock ?? null,
        pauseUntil: state?.scannerPauseUntil?.getTime() ?? null,
    };
}

async function loadControlRow(): Promise<ScannerState> {
    const state = await ScannerState.findByPk(SCANNER_ID);
    if (!state) throw new Error('Scanner state is not initialized yet');
    return state;
}

export async function isScannerPausePendingOrActive(): Promise<boolean> {
    const state = await loadControlRow();
    if (
        state.scannerPaused &&
        state.scannerPauseMode === 'temporary' &&
        state.scannerPauseUntil &&
        Date.now() >= state.scannerPauseUntil.getTime()
    ) {
        await resumeScanner();
        return false;
    }
    return state.scannerPaused || state.scannerPauseTargetBlock !== null;
}

export async function getScannerControlState(): Promise<ScannerControlState> {
    const state = await ScannerState.findByPk(SCANNER_ID);
    if (!state) {
        return {
            paused: false,
            mode: null,
            pauseRequestedAtBlock: null,
            pauseUntil: null,
        };
    }
    if (
        state.scannerPaused &&
        state.scannerPauseMode === 'temporary' &&
        state.scannerPauseUntil &&
        Date.now() >= state.scannerPauseUntil.getTime()
    ) {
        await resumeScanner();
        return {
            paused: false,
            mode: null,
            pauseRequestedAtBlock: null,
            pauseUntil: null,
        };
    }
    return toControlState(state);
}

export async function requestScannerPause(
    mode: ScannerPauseMode,
    atBlock: number | null,
    durationMinutes = SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
): Promise<void> {
    const state = await loadControlRow();
    state.scannerPauseTargetBlock = atBlock;
    state.scannerPaused = atBlock === null;
    state.scannerPauseMode = mode;
    state.scannerPauseRequestedAtBlock = atBlock;
    state.scannerPauseDurationMinutes = durationMinutes;
    state.scannerPauseUntil =
        state.scannerPaused && mode === 'temporary'
            ? new Date(Date.now() + durationMinutes * 60 * 1000)
            : null;
    await state.save();
    console.log(
        state.scannerPaused
            ? `[Scanner] Persisted pause (${mode}); checkpoint will be preserved`
            : `[Scanner] Persisted pause request after block ${atBlock} (${mode})`,
    );
}

export async function shouldPauseBeforeBlock(
    nextBlock: number,
    lastProcessedBlock: number,
): Promise<boolean> {
    const state = await loadControlRow();
    if (
        state.scannerPaused &&
        state.scannerPauseMode === 'temporary' &&
        state.scannerPauseUntil &&
        Date.now() >= state.scannerPauseUntil.getTime()
    ) {
        await resumeScanner();
        return false;
    }

    if (state.scannerPaused) return true;
    if (
        state.scannerPauseTargetBlock !== null &&
        nextBlock > state.scannerPauseTargetBlock &&
        lastProcessedBlock >= state.scannerPauseTargetBlock
    ) {
        state.scannerPaused = true;
        state.scannerPauseTargetBlock = null;
        state.scannerPauseUntil =
            state.scannerPauseMode === 'temporary'
                ? new Date(Date.now() + state.scannerPauseDurationMinutes * 60 * 1000)
                : null;
        await state.save();
        const resumeMessage = state.scannerPauseUntil
            ? `; auto-resume in ${state.scannerPauseDurationMinutes} minute(s)`
            : '; manual resume required';
        console.log(`[Scanner] Paused at checkpoint ${lastProcessedBlock}${resumeMessage}`);
        return true;
    }
    return false;
}

export async function resumeScanner(): Promise<void> {
    const state = await ScannerState.findByPk(SCANNER_ID);
    if (!state) return;
    const wasPaused = state.scannerPaused || state.scannerPauseTargetBlock !== null;
    state.scannerPaused = false;
    state.scannerPauseMode = null;
    state.scannerPauseRequestedAtBlock = null;
    state.scannerPauseUntil = null;
    state.scannerPauseTargetBlock = null;
    state.scannerPauseDurationMinutes = SCANNER_DEFAULT_PAUSE_DURATION_MINUTES;
    await state.save();
    if (wasPaused) {
        console.log('[Scanner] Persisted resume; catch-up will continue from the saved checkpoint');
    }
}
