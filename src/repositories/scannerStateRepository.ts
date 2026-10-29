import ScannerState from '../models/scannerState';

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

export interface ScannerStatusState {
    lastProcessedBlock: number;
    reorgRecoveryActive: boolean;
    reorgRecoveryBlocked: boolean;
    reorgRecoveryBlockReason: string | null;
    reorgRecoveryStableBlocks: number;
    reorgRecoveryStartBlock: number | null;
    reorgRecoveryTargetBlock: number | null;
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
