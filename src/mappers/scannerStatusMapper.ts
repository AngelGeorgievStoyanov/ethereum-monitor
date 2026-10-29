import { ScannerControlState } from '../services/scannerControlService';
import { ScannerStatusState } from '../repositories/scannerStateRepository';
import { ScannerRescanJobSummary } from '../repositories/scannerRescanJobRepository';

export interface ScannerStatusResponse {
    paused: boolean;
    mode: ScannerControlState['mode'];
    pauseRequestedAtBlock: number | null;
    pauseUntil: number | null;
    lastProcessedBlock: number | null;
    reorgRecoveryActive: boolean;
    reorgRecoveryBlocked: boolean;
    reorgRecoveryBlockReason: string | null;
    reorgRecoveryStableBlocks: number;
    reorgRecoveryStartBlock: number | null;
    reorgRecoveryTargetBlock: number | null;
    rescanJob: ScannerRescanJobSummary | null;
    recoveryMetrics: ReturnType<typeof import('../services/recoveryMetrics').getRecoveryMetrics>;
    latestFinalizedBlock: number | null;
    lagBlocks: number | null;
    rpcAvailable: boolean;
    rpcMetrics: ReturnType<typeof import('../clients/rpcClient').getRpcClient>['getMetrics'] extends () => infer T ? T : never;
    checkedAt: string;
}

export function mapScannerStatusResponse(input: {
    control: ScannerControlState;
    state: ScannerStatusState | null;
    rescanJob: ScannerRescanJobSummary | null;
    recoveryMetrics: ScannerStatusResponse['recoveryMetrics'];
    latestFinalizedBlock: number | null;
    rpcAvailable: boolean;
    rpcMetrics: ScannerStatusResponse['rpcMetrics'];
    checkedAt: string;
}): ScannerStatusResponse {
    const lastProcessedBlock = input.state?.lastProcessedBlock ?? null;

    return {
        paused: input.control.paused,
        mode: input.control.mode,
        pauseRequestedAtBlock: input.control.pauseRequestedAtBlock,
        pauseUntil: input.control.pauseUntil,
        lastProcessedBlock,
        reorgRecoveryActive: input.state?.reorgRecoveryActive ?? false,
        reorgRecoveryBlocked: input.state?.reorgRecoveryBlocked ?? false,
        reorgRecoveryBlockReason: input.state?.reorgRecoveryBlockReason ?? null,
        reorgRecoveryStableBlocks: input.state?.reorgRecoveryStableBlocks ?? 0,
        reorgRecoveryStartBlock: input.state?.reorgRecoveryStartBlock ?? null,
        reorgRecoveryTargetBlock: input.state?.reorgRecoveryTargetBlock ?? null,
        rescanJob: input.rescanJob,
        recoveryMetrics: input.recoveryMetrics,
        latestFinalizedBlock: input.latestFinalizedBlock,
        lagBlocks:
            lastProcessedBlock !== null && input.latestFinalizedBlock !== null
                ? input.latestFinalizedBlock - lastProcessedBlock
                : null,
        rpcAvailable: input.rpcAvailable,
        rpcMetrics: input.rpcMetrics,
        checkedAt: input.checkedAt,
    };
}
