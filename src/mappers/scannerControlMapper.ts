import type { ScannerControlState, ScannerPauseMode } from '../types/scanner-status.types';

export interface ScannerPauseResponse {
    message: string;
    paused: boolean;
    mode: ScannerPauseMode | null;
    pauseRequestedAtBlock: number | null;
    pauseUntil: number | null;
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

export function mapReorgRecoveryRetryResponse(input: {
    active: boolean;
    startBlock: number | null;
    targetBlock: number | null;
}): ReorgRecoveryRetryResponse {
    return {
        message: 'Reorg recovery unblocked. Resume the scanner if it is paused.',
        reorgRecoveryActive: input.active,
        reorgRecoveryBlocked: false,
        reorgRecoveryStartBlock: input.startBlock,
        reorgRecoveryTargetBlock: input.targetBlock,
    };
}
