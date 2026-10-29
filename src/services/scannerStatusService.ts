import { SCANNER_ID } from '../constants/scanner.constants';
import { findScannerStatusState } from '../repositories/scannerStateRepository';
import { findLatestScannerRescanJob } from '../repositories/scannerRescanJobRepository';
import { evmRpcClient } from './evmBlockDataService';
import { getScannerControlState } from './scannerControlService';
import { getRecoveryMetrics } from './recoveryMetrics';
import { mapScannerStatusResponse } from '../mappers/scannerStatusMapper';

export async function getScannerStatusResponse() {
    const [control, state, rescanJob] = await Promise.all([
        getScannerControlState(),
        findScannerStatusState(SCANNER_ID),
        findLatestScannerRescanJob(),
    ]);

    let latestFinalizedBlock: number | null = null;
    let rpcAvailable = false;

    try {
        const finalized = await evmRpcClient.getBlock('finalized');
        if (finalized) {
            latestFinalizedBlock = finalized.number;
            rpcAvailable = true;
        }
    } catch {
        // Status remains available while RPC providers are temporarily unavailable.
    }

    return mapScannerStatusResponse({
        control,
        state,
        rescanJob,
        recoveryMetrics: getRecoveryMetrics(),
        latestFinalizedBlock,
        rpcAvailable,
        rpcMetrics: evmRpcClient.getMetrics(),
        checkedAt: new Date().toISOString(),
    });
}
