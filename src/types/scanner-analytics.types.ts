export interface ScannerAnalyticsResponse {
    generatedAt: string;
    window: string;
    current: Record<string, unknown>;
    blockSamples: Array<Record<string, unknown>>;
    rpcEvents: Array<Record<string, unknown>>;
    catchUpSessions: Array<Record<string, unknown>>;
}
