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

export function isScannerPausePendingOrActive(): boolean {
    refreshTimeout();
    return state.paused || targetBlock !== null;
}

export function getScannerControlState(): ScannerControlState {
    refreshTimeout();
    return { ...state };
}

function refreshTimeout(): void {
    if (state.paused && state.mode === 'temporary' && state.pauseUntil !== null && Date.now() >= state.pauseUntil) {
        console.log('[Scanner] Temporary pause expired; resuming automatically');
        resumeScanner();
    }
}

export function requestScannerPause(mode: ScannerPauseMode, atBlock: number | null): void {
    targetBlock = atBlock;
    state.paused = atBlock === null;
    state.mode = mode;
    state.pauseRequestedAtBlock = atBlock;
    state.pauseUntil = state.paused && mode === 'temporary' ? Date.now() + 5 * 60 * 1000 : null;
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
        state.pauseUntil = state.mode === 'temporary' ? Date.now() + 5 * 60 * 1000 : null;
        console.log(
            `[Scanner] Paused at checkpoint ${lastProcessedBlock}${state.pauseUntil ? '; auto-resume in 5 minutes' : '; manual resume required'}`,
        );
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
    if (wasPaused) console.log('[Scanner] Resumed; catch-up will continue from the saved checkpoint');
}
