export interface ScannerAnalyticsWindowMetrics {
    processing: {
        processedBlocks: number;
        processedTransactions: number;
        blocksPerSecond: number;
        transactionsPerSecond: number;
        blocksPerSecondLastMinute: number;
        transactionsPerSecondLastMinute: number;
        averageTransactionsPerBlock: number | null;
        /** Sum of successful batch execution durations; excludes waiting for new finalized blocks. */
        activeProcessingDurationMs: number;
        activeBlocksPerSecond: number;
        activeTransactionsPerSecond: number;
        averageActiveProcessingMsPerBlock: number | null;
        averageActiveProcessingMsPerTransaction: number | null;
        processingBatches: number;
        averageBlocksPerBatch: number;
        minBlocksPerBatch: number;
        maxBlocksPerBatch: number;
        batchSizeDistribution: Record<string, number>;
        averageBatchDurationMs: number | null;
        averageFetchStageDurationMs: number | null;
        averageProcessingStageDurationMs: number | null;
        averagePersistenceStageDurationMs: number | null;
        averageMaxConcurrentFetches: number | null;
        averageMaxConcurrentProcessing: number | null;
        maxObservedConcurrentFetches: number;
        maxObservedConcurrentProcessing: number;
        averageBlockDurationMs: number | null;
        averageFilterDurationMs: number | null;
        averageDatabaseBatchWriteDurationMs: number | null;
    };
    catchUp: {
        netLagReductionPerSecond: number | null;
        netLagReductionPerSecondLastMinute: number | null;
        lagAtAnalyticsWindowStart: number | null;
        lagAtAnalyticsWindowEnd: number | null;
        analyticsMeasurementDurationMs: number;
        lagAtWindowStart: number | null;
        lagAtWindowEnd: number | null;
        measurementDurationMs: number;
    };
    rpc: {
        totalRequests: number;
        failures: number;
        rateLimitErrors: number;
        timeoutErrors: number;
        connectionErrors: number;
        providerErrors: number;
        jsonRpcErrors: number;
        otherErrors: number;
        retryableFailures: number;
        averageLatencyMs: number | null;
        latencyP95Ms: number | null;
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
        averageQueryDurationMs: number | null;
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
        averageDurationMs: number | null;
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
