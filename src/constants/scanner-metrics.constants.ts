export const METRICS_RETENTION_MS = 10800000;
export const METRICS_BUCKET_INTERVAL_MS = 60000;
export const METRICS_MAX_BUCKETS = Math.ceil(METRICS_RETENTION_MS / METRICS_BUCKET_INTERVAL_MS);

export const METRICS_RPC_EVENT_COMPACTION_THRESHOLD = 1000;
export const METRICS_SAMPLE_COMPACTION_THRESHOLD = 1000;

export const METRICS_ANALYTICS_RECENT_RPC_ERRORS = 12;

export const METRICS_SAMPLE_LIMITS = {
    blocks: 10000,
    rpcEvents: 10000,
    lag: 5000,
    batches: 1000,
    catchUpSessions: 100,
    recentRpcErrors: 100,
} as const;

export const METRICS_TIME_WINDOWS = [
    { value: '1h', label: 'Last hour', durationMs: 3600000 },
    { value: '3h', label: 'Last 3 hours', durationMs: METRICS_RETENTION_MS },
] as const;

export const DEFAULT_METRICS_WINDOW = METRICS_TIME_WINDOWS[0];
export const METRICS_PUBLISH_INTERVAL_MS = 10000;
export const METRICS_ANALYTICS_REFRESH_INTERVAL_MS = 5000;

export const METRICS_RECENT_BLOCK_WINDOW_MS = 60000;
export const METRICS_RECENT_RATE_WINDOW_MS = 60000;
export const METRICS_FINALIZED_SAMPLE_WINDOW_MS = 900000;
export const METRICS_CATCH_UP_ETA_MIN_DURATION_MS = 10000;
export const METRICS_MIN_ANALYTICS_WINDOW_MS = 60000;
