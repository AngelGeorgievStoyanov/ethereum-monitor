import ScannerState from '../models/scannerState';
import type { ScannerRuntimeState } from '../types/scanner-state.types';
import type { ScannerStatusState } from '../types/scanner-status.types';

function toScannerRuntimeState(state: ScannerState): ScannerRuntimeState {
    return {
        id: state.id,
        lastProcessedBlock: state.lastProcessedBlock,
        lastRescanFromBlock: state.lastRescanFromBlock,
        reorgRecoveryActive: state.reorgRecoveryActive,
        reorgRecoveryBlocked: state.reorgRecoveryBlocked,
        reorgRecoveryBlockReason: state.reorgRecoveryBlockReason,
        reorgRecoveryStableBlocks: state.reorgRecoveryStableBlocks,
        reorgRecoveryStartBlock: state.reorgRecoveryStartBlock,
        reorgRecoveryTargetBlock: state.reorgRecoveryTargetBlock,
    };
}

const scannerRuntimeAttributes = [
    'id',
    'lastProcessedBlock',
    'lastRescanFromBlock',
    'reorgRecoveryActive',
    'reorgRecoveryBlocked',
    'reorgRecoveryBlockReason',
    'reorgRecoveryStableBlocks',
    'reorgRecoveryStartBlock',
    'reorgRecoveryTargetBlock',
] as const;

export async function findScannerState(id: string): Promise<ScannerRuntimeState | null> {
    const state = await ScannerState.findByPk(id, { attributes: scannerRuntimeAttributes });
    return state ? toScannerRuntimeState(state) : null;
}

export async function createScannerState(data: {
    id: string;
    lastProcessedBlock: number;
    lastRescanFromBlock: number | null;
}): Promise<ScannerRuntimeState> {
    const state = await ScannerState.create(data);
    return toScannerRuntimeState(state);
}

export async function updateScannerCheckpoint(id: string, lastProcessedBlock: number) {
    const [updatedRows] = await ScannerState.update({ lastProcessedBlock }, { where: { id } });

    if (updatedRows !== 1) {
        throw new Error(`Unable to update scanner checkpoint for "${id}"`);
    }
}

export async function findScannerStatusState(id: string): Promise<ScannerStatusState | null> {
    const state = await ScannerState.findByPk(id, {
        attributes: [
            'lastProcessedBlock',
            'reorgRecoveryActive',
            'reorgRecoveryBlocked',
            'reorgRecoveryBlockReason',
            'reorgRecoveryStableBlocks',
            'reorgRecoveryStartBlock',
            'reorgRecoveryTargetBlock',
        ],
    });
    if (!state) return null;

    return {
        lastProcessedBlock: state.lastProcessedBlock,
        reorgRecoveryActive: state.reorgRecoveryActive,
        reorgRecoveryBlocked: state.reorgRecoveryBlocked,
        reorgRecoveryBlockReason: state.reorgRecoveryBlockReason,
        reorgRecoveryStableBlocks: state.reorgRecoveryStableBlocks,
        reorgRecoveryStartBlock: state.reorgRecoveryStartBlock,
        reorgRecoveryTargetBlock: state.reorgRecoveryTargetBlock,
    };
}

export async function findScannerControlRecord(id: string) {
    const state = await ScannerState.findByPk(id, {
        attributes: [
            'scannerPaused',
            'scannerPauseMode',
            'scannerPauseRequestedAtBlock',
            'scannerPauseUntil',
            'scannerPauseTargetBlock',
            'scannerPauseDurationMinutes',
        ],
    });
    if (!state) return null;

    return {
        paused: state.scannerPaused,
        mode: state.scannerPauseMode,
        pauseRequestedAtBlock: state.scannerPauseRequestedAtBlock,
        pauseUntil: state.scannerPauseUntil?.getTime() ?? null,
        pauseUntilDate: state.scannerPauseUntil,
        pauseTargetBlock: state.scannerPauseTargetBlock,
        pauseDurationMinutes: state.scannerPauseDurationMinutes,
    };
}

export async function updateScannerControlRecord(
    id: string,
    updates: {
        scannerPaused?: boolean;
        scannerPauseMode?: 'manual' | 'temporary' | null;
        scannerPauseRequestedAtBlock?: number | null;
        scannerPauseUntil?: Date | null;
        scannerPauseTargetBlock?: number | null;
        scannerPauseDurationMinutes?: number;
    },
): Promise<void> {
    const [updatedRows] = await ScannerState.update(updates, { where: { id } });
    if (updatedRows !== 1) {
        throw new Error(`Unable to update scanner control state for "${id}"`);
    }
}

export async function unblockScannerReorgRecovery(id: string): Promise<boolean> {
    const [updatedRows] = await ScannerState.update(
        {
            reorgRecoveryBlocked: false,
            reorgRecoveryBlockReason: null,
        },
        {
            where: {
                id,
                reorgRecoveryActive: true,
                reorgRecoveryBlocked: true,
            },
        },
    );
    return updatedRows === 1;
}

export interface ScannerRescanState {
    lastProcessedBlock: number;
    reorgRecoveryActive: boolean;
    reorgRecoveryBlocked: boolean;
}

export async function findScannerRescanState(id: string): Promise<ScannerRescanState | null> {
    const state = await ScannerState.findByPk(id, {
        attributes: ['lastProcessedBlock', 'reorgRecoveryActive', 'reorgRecoveryBlocked'],
    });
    if (!state) return null;
    return {
        lastProcessedBlock: state.lastProcessedBlock,
        reorgRecoveryActive: state.reorgRecoveryActive,
        reorgRecoveryBlocked: state.reorgRecoveryBlocked,
    };
}
