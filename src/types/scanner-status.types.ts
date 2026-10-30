export type ScannerPauseMode = 'manual' | 'temporary';

export interface ScannerControlState {
    paused: boolean;
    mode: ScannerPauseMode | null;
    pauseRequestedAtBlock: number | null;
    pauseUntil: number | null;
}

export interface ScannerControlRecord extends ScannerControlState {
    pauseUntilDate: Date | null;
    pauseTargetBlock: number | null;
    pauseDurationMinutes: number;
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

export type ScannerRescanJobStatus =
    'QUEUED' | 'RUNNING' | 'COMPLETED' | 'RECOVERY_STARTED' | 'FAILED' | 'INTERRUPTED';

export interface ScannerRescanJobSummary {
    id: string;
    fromBlock: number;
    toBlock: number;
    currentBlock: number | null;
    blocksProcessed: number;
    status: ScannerRescanJobStatus;
    error: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface RecoveryMetrics {
    reorgCount: number;
    reorgDepthLast: number;
    reorgDepthMax: number;
    reorgRecoveryDurationMsLast: number;
    reorgConsensusFailuresTotal: number;
    reorgBlocksReprocessedTotal: number;
    rescanRunsTotal: number;
    rescanBlocksProcessedTotal: number;
    rescanFailuresTotal: number;
}

export interface RpcEndpointMetrics {
    index: number;
    attempts: number;
    successes: number;
    failures: number;
    retryableFailures: number;
    totalDurationMs: number;
    lastFailureAt: string | null;
}

export interface RecentBlockMetric {
    blockNumber: number;
    processedAt: string;
    blockDurationMs: number;
    fetchDurationMs: number;
    filterMatchingDurationMs: number;
    databaseWriteDurationMs: number;
    nativeTransfersSeen: number;
    nativeMatches: number;
    erc20TransferLogsSeen: number;
    erc20Matches: number;
}

export interface BlockProcessingMetrics {
    processedBlocks: number;
    totalTransactions: number;
    totalNativeTransfersSeen: number;
    totalNativeMatches: number;
    totalErc20TransferLogsSeen: number;
    totalErc20Matches: number;
    totalErc20FailedAttemptsSeen: number;
    totalErc20FailedAttemptsMatched: number;
    totalFetchDurationMs: number;
    totalGetBlockDurationMs: number;
    totalGetBlockReceiptsDurationMs: number;
    totalFilterMatchingDurationMs: number;
    totalBlockDurationMs: number;
    totalDatabaseWriteDurationMs: number;
    lastProcessedBlock: number | null;
    lastProcessedAt: string | null;
    lastBlockDurationMs: number | null;
    blocksProcessedLastMinute: number;
    blocksPerSecondLastMinute: number;
    averageBlockDurationLastMinuteMs: number | null;
    averageFetchDurationLastMinuteMs: number | null;
    averageDatabaseWriteDurationLastMinuteMs: number | null;
    recentBlocks: RecentBlockMetric[];
}

export interface ScannerStatusResponse {
    paused: boolean;
    mode: ScannerPauseMode | null;
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
    recoveryMetrics: RecoveryMetrics;
    processingMetrics: BlockProcessingMetrics;
    activeFiltersCount: number;
    processUptimeSeconds: number;
    latestFinalizedBlock: number | null;
    lagBlocks: number | null;
    rpcAvailable: boolean;
    rpcMetrics: RpcEndpointMetrics[];
    checkedAt: string;
}
