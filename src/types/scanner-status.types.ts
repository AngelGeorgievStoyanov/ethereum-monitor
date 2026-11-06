export interface ScannerControlState {
    paused: boolean;
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
    rateLimitFailures: number;
    totalDurationMs: number;
    lastFailureAt: string | null;
    lastFailureKind: string | null;
    lastHttpStatus: number | null;
    lastRpcCode: number | null;
    lastFailureMessage: string | null;
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
    blocksProcessedLast60Seconds: number;
    blocksPerSecondLast60Seconds: number;
    averageBlockDurationLast60SecondsMs: number | null;
    averageFetchDurationLast60SecondsMs: number | null;
    averageDatabaseWriteDurationLast60SecondsMs: number | null;
    recentBlocks: RecentBlockMetric[];
}

export interface ScannerStatusResponse {
    scannerRunning: boolean;
    paused: boolean;
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
    latestFinalizedAt: string | null;
    lagBlocks: number | null;
    finalizedRegression: boolean;
    finalizedRegressionMessage: string | null;
    rpcAvailable: boolean;
    rpcMetrics: RpcEndpointMetrics[];
    checkedAt: string;
}
