export interface ScannerAnalyticsResponse {
    generatedAt: string;
    window: string;
    requestedWindowMs: number;
    availableWindowMs: number;
    windowCoverage: 'complete' | 'partial' | 'available';
    historyStartedAt: string;
    availableWindows: Array<{ value: string; label: string }>;
    current: Record<string, unknown>;
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
