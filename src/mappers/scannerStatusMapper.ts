import type {
    ScannerControlState,
    ScannerRescanJobSummary,
    ScannerStatusResponse,
    ScannerStatusState,
    RecoveryMetrics,
    RpcEndpointMetrics,
} from '../types/scanner-status.types';

export function mapScannerStatusResponse(input: {
    control: ScannerControlState;
    state: ScannerStatusState | null;
    rescanJob: ScannerRescanJobSummary | null;
    recoveryMetrics: RecoveryMetrics;
    latestFinalizedBlock: number | null;
    rpcAvailable: boolean;
    rpcMetrics: RpcEndpointMetrics[];
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
