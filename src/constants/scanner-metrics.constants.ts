export const METRICS_RETENTION_MS = 86400000;
export const METRICS_BUCKET_INTERVAL_MS = 60000;
export const METRICS_MAX_BUCKETS = Math.ceil(METRICS_RETENTION_MS / METRICS_BUCKET_INTERVAL_MS);

export const METRICS_SAMPLE_LIMITS = {
    blocks: 100000,
    rpcEvents: 100000,
    lag: 100000,
    batches: 10000,
    catchUpSessions: 1000,
    recentRpcErrors: 100,
} as const;

export const METRICS_TIME_WINDOWS = [
    { value: '1h', label: 'Last hour', durationMs: 3600000 },
    { value: '3h', label: 'Last 3 hours', durationMs: 10800000 },
    { value: '6h', label: 'Last 6 hours', durationMs: 21600000 },
    { value: '9h', label: 'Last 9 hours', durationMs: 32400000 },
    { value: '12h', label: 'Last 12 hours', durationMs: 43200000 },
    { value: '24h', label: 'Last 24 hours', durationMs: METRICS_RETENTION_MS },
] as const;

export const DEFAULT_METRICS_WINDOW = METRICS_TIME_WINDOWS[0];
export const METRICS_PUBLISH_INTERVAL_MS = 10000;
export const METRICS_ANALYTICS_REFRESH_INTERVAL_MS = 30000;
export const AVAILABLE_METRICS_WINDOW = 'available';
