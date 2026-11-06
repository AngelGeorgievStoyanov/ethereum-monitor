export interface ScannerAnalyticsWindowMetrics {
    processing: {
        processedBlocksInSelectedWindow: number;
        processedTransactionsInSelectedWindow: number;
        averageBlocksPerSecondInSelectedWindow: number;
        averageTransactionsPerSecondInSelectedWindow: number;
        blocksPerSecondLast60Seconds: number;
        transactionsPerSecondLast60Seconds: number;
        averageTransactionsPerBlockInSelectedWindow: number | null;
        /** Sum of successful batch execution durations; excludes waiting for new finalized blocks. */
        totalBatchElapsedDurationMsInSelectedWindow: number;
        blocksPerSecondDuringBatchExecutionInSelectedWindow: number;
        transactionsPerSecondDuringBatchExecutionInSelectedWindow: number;
        averageBatchElapsedMsPerBlockInSelectedWindow: number | null;
        averageBatchElapsedMsPerTransactionInSelectedWindow: number | null;
        completedBatchesInSelectedWindow: number;
        averageBlocksPerBatchInSelectedWindow: number;
        minBlocksPerBatchInSelectedWindow: number;
        maxBlocksPerBatchInSelectedWindow: number;
        batchSizeDistributionInSelectedWindow: Record<string, number>;
        averageBatchElapsedDurationMsInSelectedWindow: number | null;
        averageFetchStageDurationMsInSelectedWindow: number | null;
        averageProcessingStageDurationMsInSelectedWindow: number | null;
        averagePersistenceStageDurationMsInSelectedWindow: number | null;
        averageBatchMaxConcurrentFetchesInSelectedWindow: number | null;
        averageBatchMaxConcurrentProcessingInSelectedWindow: number | null;
        maxBatchConcurrentFetchesInSelectedWindow: number;
        maxBatchConcurrentProcessingInSelectedWindow: number;
        activeFetchesNow: number;
        timeWeightedAverageFetchConcurrencyLast60Seconds: number;
        maxConcurrentFetchesLast60Seconds: number;
        fetchSlotUtilizationPercentLast60Seconds: number | null;
        averageNoFetchDurationPerCompletedBatchLast60Seconds: number | null;
        timeWeightedAverageFetchConcurrencyLast60Seconds: number | null;
        averageBlockDurationMsInSelectedWindow: number | null;
        averageFilterEvaluationDurationMsInSelectedWindow: number | null;
        averageDatabaseBatchWriteDurationMsInSelectedWindow: number | null;
    };
    catchUp: {
        netLagReductionPerSecondInSelectedWindow: number | null;
        netLagReductionPerSecondLast60Seconds: number | null;
        lagAtAnalyticsWindowStart: number | null;
        lagAtAnalyticsWindowEnd: number | null;
        analyticsMeasurementDurationMs: number;
        lagAtLast60SecondsWindowStart: number | null;
        lagAtLast60SecondsWindowEnd: number | null;
        measurementDurationMsLast60Seconds: number;
    };
    rpc: {
        totalRequests: number;
        concurrency: {
            activeRpcRequestsNow: number;
            timeWeightedAverageActiveRpcRequestsLast60Seconds: number | null;
            maxActiveRpcRequestsLast60Seconds: number;
        };
        failures: number;
        rateLimitErrors: number;
        timeoutErrors: number;
        connectionErrors: number;
        providerErrors: number;
        jsonRpcErrors: number;
        otherErrors: number;
        retryableFailures: number;
        averageLatencyMsInSelectedWindow: number | null;
        latencyP95MsInSelectedWindow: number | null;
        methods: Array<{
            method: string;
            requests: number;
            successes: number;
            failures: number;
            totalDurationMs: number;
        }>;
        operations: {
            totalOperations: number;
            successfulOperations: number;
            failedOperations: number;
            retriedOperations: number;
            totalRetryAttempts: number;
            endpointFailovers: number;
            averageAttemptsPerSuccessfulOperation: number | null;
        };
    };
    database: {
        queries: number;
        reads: number;
        writes: number;
        other: number;
        failures: number;
        averageQueryDurationMsInSelectedWindow: number | null;
        /** Explicitly timed persistence transactions for successfully processed batches. */
        batchWrites: number;
        totalBatchWriteDurationMs: number;
        averageBatchWriteDurationMs: number | null;
        averageBatchWriteDurationMsPerBlock: number | null;
        byOperation: Record<
            string,
            { count: number; totalDurationMs: number; maxDurationMs: number }
        >;
    };
    filters: {
        evaluations: number;
        matches: number;
        failures: number;
        averageEvaluationDurationMsInSelectedWindow: number | null;
        byFilter: Record<
            string,
            { evaluations: number; matches: number; failures: number; totalDurationMs: number }
        >;
    };
}

export interface ScannerAnalyticsResponse {
    generatedAt: string;
    window: string;
    requestedWindowMs: number;
    availableWindowMs: number;
    windowCoverage: 'complete' | 'partial';
    historyStartedAt: string;
    availableWindows: Array<{ value: string; label: string }>;
    current: Record<string, unknown>;
    windowMetrics: ScannerAnalyticsWindowMetrics;
    /** Up to 12 most recent RPC errors within the selected analytics window. */
    rpcEvents: Array<Record<string, unknown>>;
    catchUpSessions: Array<Record<string, unknown>>;
    batches: Array<Record<string, unknown>>;
    minuteBuckets: Array<Record<string, unknown>>;
    retention: {
        oldestBlockSampleAt: string | null;
        oldestRpcEventAt: string | null;
        blockSamples: number;
        lagSamples: number;
        rpcEvents: number;
        catchUpSessions: number;
        batches: number;
        minuteBuckets: number;
    };
}
