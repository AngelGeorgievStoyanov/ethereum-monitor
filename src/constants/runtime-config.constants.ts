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

export const RUNTIME_CONFIG_DEFAULTS = {
    'scanner.maxParallelBlocks': SCANNER_MAX_PARALLEL_BLOCKS,
    'scanner.parallelProcessingLagBlocks': SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
    'scanner.maxBlocksPerCatchup': MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    'scanner.pollIntervalMs': SCANNER_POLL_INTERVAL_MS,
    'metrics.publishIntervalMs': METRICS_PUBLISH_INTERVAL_MS,
    'metrics.analyticsRefreshMs': METRICS_ANALYTICS_REFRESH_INTERVAL_MS,
} as const;

export type RuntimeConfig = {
    [Key in keyof typeof RUNTIME_CONFIG_DEFAULTS]: number;
};
export type RuntimeConfigKey = keyof RuntimeConfig;