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
