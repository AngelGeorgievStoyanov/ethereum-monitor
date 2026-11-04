import '../models/registerModels';
import sequelize from '../database';
import Configuration from '../models/configuration';
import {
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
    SCANNER_POLL_INTERVAL_MS,
} from '../constants/scanner.constants';
import {
    METRICS_ANALYTICS_REFRESH_INTERVAL_MS,
    METRICS_PUBLISH_INTERVAL_MS,
} from '../constants/scanner-metrics.constants';
import { createDatabaseIfNotExists } from './createDatabaseIfNotExists';

export async function initializeDatabase(): Promise<void> {
    await createDatabaseIfNotExists();
    await sequelize.authenticate();
    await sequelize.sync();

    await Configuration.bulkCreate(
        [
            {
                settingKey: 'maxParallelBlocks',
                value: String(SCANNER_MAX_PARALLEL_BLOCKS),
            },
            {
                settingKey: 'parallelProcessingLagBlocks',
                value: String(SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS),
            },
            {
                settingKey: 'maxBlocksPerCatchup',
                value: String(MAX_BLOCKS_PER_FINALIZED_CATCHUP),
            },
            {
                settingKey: 'pollIntervalMs',
                value: String(SCANNER_POLL_INTERVAL_MS),
            },
            {
                settingKey: 'publishIntervalMs',
                value: String(METRICS_PUBLISH_INTERVAL_MS),
            },
            {
                settingKey: 'analyticsRefreshMs',
                value: String(METRICS_ANALYTICS_REFRESH_INTERVAL_MS),
            },
        ],
        { ignoreDuplicates: true },
    );

    console.log('[Database] Connection established, missing tables synchronized, and default configuration seeded');
}
