export interface ScannerAnalyticsWindowMetrics {
    processing: {
        processedBlocks: number;
        processedTransactions: number;
        blocksPerSecond: number;
        transactionsPerSecond: number;
        averageTransactionsPerBlock: number | null;
        averageBlockDurationMs: number | null;
        averageFilterDurationMs: number | null;
        averageDatabaseBatchWriteDurationMs: number | null;
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
        methods: Array<{ method: string; requests: number; successes: number; failures: number; totalDurationMs: number }>;
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
        failures: number;
        averageQueryDurationMs: number | null;
        byOperation: Record<string, { count: number; totalDurationMs: number; maxDurationMs: number }>;
    };
    filters: {
        evaluations: number;
        matches: number;
        failures: number;
        averageDurationMs: number | null;
        byFilter: Record<string, { evaluations: number; matches: number; failures: number; totalDurationMs: number }>;
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
    blockSamples: Array<Record<string, unknown>>;
    lagSamples: Array<Record<string, unknown>>;
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
