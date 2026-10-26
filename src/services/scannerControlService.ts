export type ScannerPauseMode = 'manual' | 'temporary';

export interface ScannerControlState {
    paused: boolean;
    mode: ScannerPauseMode | null;
    pauseRequestedAtBlock: number | null;
    pauseUntil: number | null;
}

const state: ScannerControlState = {
    paused: false,
    mode: null,
    pauseRequestedAtBlock: null,
    pauseUntil: null,
};

let targetBlock: number | null = null;
let pauseDurationMinutes = 5;

export function isScannerPausePendingOrActive(): boolean {
    refreshTimeout();
    return state.paused || targetBlock !== null;
}

export function getScannerControlState(): ScannerControlState {
    refreshTimeout();
    return { ...state };
}

function refreshTimeout(): void {
    if (
        state.paused &&
        state.mode === 'temporary' &&
        state.pauseUntil !== null &&
        Date.now() >= state.pauseUntil
    ) {
        console.log('[Scanner] Temporary pause expired; resuming automatically');
        resumeScanner();
    }
}

export function requestScannerPause(
    mode: ScannerPauseMode,
    atBlock: number | null,
    durationMinutes = 5,
): void {
    targetBlock = atBlock;
    state.paused = atBlock === null;
    state.mode = mode;
    state.pauseRequestedAtBlock = atBlock;
    pauseDurationMinutes = durationMinutes;
    state.pauseUntil =
        state.paused && mode === 'temporary' ? Date.now() + pauseDurationMinutes * 60 * 1000 : null;
    console.log(
        state.paused
            ? `[Scanner] Paused (${mode}); checkpoint will be preserved`
            : `[Scanner] Pause requested after block ${atBlock} (${mode})`,
    );
}

export function shouldPauseBeforeBlock(nextBlock: number, lastProcessedBlock: number): boolean {
    refreshTimeout();
    if (state.paused) return true;
    if (targetBlock !== null && nextBlock > targetBlock && lastProcessedBlock >= targetBlock) {
        state.paused = true;
        targetBlock = null;
        state.pauseUntil =
            state.mode === 'temporary' ? Date.now() + pauseDurationMinutes * 60 * 1000 : null;
        const resumeMessage = state.pauseUntil
            ? `; auto-resume in ${pauseDurationMinutes} minute(s)`
            : '; manual resume required';
        console.log(`[Scanner] Paused at checkpoint ${lastProcessedBlock}${resumeMessage}`);
        return true;
    }
    return false;
}

export function resumeScanner(): void {
    const wasPaused = state.paused || targetBlock !== null;
    state.paused = false;
    state.mode = null;
    state.pauseRequestedAtBlock = null;
    state.pauseUntil = null;
    targetBlock = null;
    pauseDurationMinutes = 5;
    if (wasPaused)
        console.log('[Scanner] Resumed; catch-up will continue from the saved checkpoint');
}
