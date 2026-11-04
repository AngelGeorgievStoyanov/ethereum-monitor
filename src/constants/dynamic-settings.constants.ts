import {
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
    SCANNER_POLL_INTERVAL_MS,
} from './scanner.constants';
import {
    METRICS_ANALYTICS_REFRESH_INTERVAL_MS,
    METRICS_PUBLISH_INTERVAL_MS,
} from './scanner-metrics.constants';

export const DYNAMIC_SETTINGS_DEFAULTS = {
    scanner: {
        maxParallelBlocks: SCANNER_MAX_PARALLEL_BLOCKS,
        parallelProcessingLagBlocks: SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
        maxBlocksPerCatchup: MAX_BLOCKS_PER_FINALIZED_CATCHUP,
        pollIntervalMs: SCANNER_POLL_INTERVAL_MS,
    },
    metrics: {
        publishIntervalMs: METRICS_PUBLISH_INTERVAL_MS,
        analyticsRefreshMs: METRICS_ANALYTICS_REFRESH_INTERVAL_MS,
    },
} as const;

export type DynamicSettings = {
    scanner: {
        maxParallelBlocks: number;
        parallelProcessingLagBlocks: number;
        maxBlocksPerCatchup: number;
        pollIntervalMs: number;
    };
    metrics: {
        publishIntervalMs: number;
        analyticsRefreshMs: number;
    };
};

export type DynamicSettingKey =
    | 'scanner.maxParallelBlocks'
    | 'scanner.parallelProcessingLagBlocks'
    | 'scanner.maxBlocksPerCatchup'
    | 'scanner.pollIntervalMs'
    | 'metrics.publishIntervalMs'
    | 'metrics.analyticsRefreshMs';
