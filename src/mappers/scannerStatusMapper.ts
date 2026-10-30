import type {
    BlockProcessingMetrics,
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
    processingMetrics: BlockProcessingMetrics;
    activeFiltersCount: number;
    processUptimeSeconds: number;
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
        processingMetrics: input.processingMetrics,
        activeFiltersCount: input.activeFiltersCount,
        processUptimeSeconds: input.processUptimeSeconds,
        latestFinalizedBlock: input.latestFinalizedBlock,
        lagBlocks:
            lastProcessedBlock !== null && input.latestFinalizedBlock !== null
                ? Math.max(0, input.latestFinalizedBlock - lastProcessedBlock)
                : null,
        rpcAvailable: input.rpcAvailable,
        rpcMetrics: input.rpcMetrics,
        checkedAt: input.checkedAt,
    };
}
