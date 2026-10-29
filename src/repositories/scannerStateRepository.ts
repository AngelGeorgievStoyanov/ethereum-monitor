import ScannerState from '../models/scannerState';
import type { ScannerStatusState } from '../types/scanner-status.types';

export function findScannerState(id: string) {
    return ScannerState.findByPk(id);
}

export function createScannerState(data: {
    id: string;
    lastProcessedBlock: number;
    lastRescanFromBlock: number | null;
}) {
    return ScannerState.create(data);
}

export function saveScannerState(state: ScannerState) {
    return state.save();
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
