import type { ScannerControlState, ScannerStatusState } from '../types/scanner-status.types';

export interface ScannerPauseResponse {
    message: string;
    paused: boolean;
}

export interface ReorgRecoveryRetryResponse {
    message: string;
    reorgRecoveryActive: boolean;
    reorgRecoveryBlocked: boolean;
    reorgRecoveryStartBlock: number | null;
    reorgRecoveryTargetBlock: number | null;
}

export function mapScannerControlResponse(
    message: string,
    state: ScannerControlState,
): ScannerPauseResponse {
    return { message, ...state };
}

export function mapReorgRecoveryRetryResponse(
    state: ScannerStatusState,
): ReorgRecoveryRetryResponse {
    return {
        message: 'Reorg recovery unblocked. Resume the scanner if it is paused.',
        reorgRecoveryActive: state.reorgRecoveryActive,
        reorgRecoveryBlocked: false,
        reorgRecoveryStartBlock: state.reorgRecoveryStartBlock,
        reorgRecoveryTargetBlock: state.reorgRecoveryTargetBlock,
    };
}

export function mapScannerResumeResponse(state: ScannerControlState): ScannerPauseResponse {
    return mapScannerControlResponse(
        'Scanner resume requested; it will be applied on the next control refresh',
        state,
    );
}
