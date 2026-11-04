import ScannerStateModel from '../models/scannerState';
import type { ScannerState } from '../types/scanner-state.types';
import type { ScannerStatusState } from '../types/scanner-status.types';

function toScannerState(state: ScannerState): ScannerState {
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

const scannerStateAttributes = [
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

export async function findScannerState(id: string): Promise<ScannerState | null> {
    const state = await ScannerStateModel.findByPk(id, { attributes: [...scannerStateAttributes] });
    return state ? toScannerState(state) : null;
}

export async function createScannerState(data: {
    id: string;
    lastProcessedBlock: number;
    lastRescanFromBlock: number | null;
}): Promise<ScannerState> {
    const state = await ScannerStateModel.create(data);
    return toScannerState(state);
}

export async function updateScannerCheckpoint(id: string, lastProcessedBlock: number) {
    const [updatedRows] = await ScannerStateModel.update({ lastProcessedBlock }, { where: { id } });

    if (updatedRows !== 1) {
        throw new Error(`Unable to update scanner checkpoint for "${id}"`);
    }
}

export async function findScannerStatusState(id: string): Promise<ScannerStatusState | null> {
    const state = await ScannerStateModel.findByPk(id, {
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
    const state = await ScannerStateModel.findByPk(id, {
        attributes: ['scannerPaused'],
    });
    if (!state) return null;

    return { paused: state.scannerPaused };
}

export async function updateScannerControlRecord(
    id: string,
    updates: { scannerPaused: boolean },
): Promise<void> {
    const [updatedRows] = await ScannerStateModel.update(updates, { where: { id } });
    if (updatedRows !== 1) {
        throw new Error(`Unable to update scanner control state for "${id}"`);
    }
}

export async function unblockScannerReorgRecovery(id: string): Promise<boolean> {
    const [updatedRows] = await ScannerStateModel.update(
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
    const state = await ScannerStateModel.findByPk(id, {
        attributes: ['lastProcessedBlock', 'reorgRecoveryActive', 'reorgRecoveryBlocked'],
    });
    if (!state) return null;
    return {
        lastProcessedBlock: state.lastProcessedBlock,
        reorgRecoveryActive: state.reorgRecoveryActive,
        reorgRecoveryBlocked: state.reorgRecoveryBlocked,
    };
}
