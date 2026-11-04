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

    const defaultConfigurations = [
        {
            settingKey: 'maxParallelBlocks',
            value: String(SCANNER_MAX_PARALLEL_BLOCKS),
            description: 'Maximum number of blocks processed concurrently by the scanner.',
        },
        {
            settingKey: 'parallelProcessingLagBlocks',
            value: String(SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS),
            description: 'Number of blocks the scanner stays behind the chain head during processing.',
        },
        {
            settingKey: 'maxBlocksPerCatchup',
            value: String(MAX_BLOCKS_PER_FINALIZED_CATCHUP),
            description: 'Maximum number of finalized blocks processed in a single catch-up batch.',
        },
        {
            settingKey: 'pollIntervalMs',
            value: String(SCANNER_POLL_INTERVAL_MS),
            description: 'Interval between scanner checks for newly available blocks, in milliseconds.',
        },
        {
            settingKey: 'publishIntervalMs',
            value: String(METRICS_PUBLISH_INTERVAL_MS),
            description: 'Interval at which collected scanner metrics are published, in milliseconds.',
        },
        {
            settingKey: 'analyticsRefreshMs',
            value: String(METRICS_ANALYTICS_REFRESH_INTERVAL_MS),
            description: 'Interval at which metrics analytics are recalculated, in milliseconds.',
        },
    ];

    await Configuration.bulkCreate(defaultConfigurations, { ignoreDuplicates: true });

    for (const configuration of defaultConfigurations) {
        await Configuration.update(
            { description: configuration.description },
            {
                where: {
                    settingKey: configuration.settingKey,
                    description: null,
                },
            },
        );
    }

    console.log('[Database] Connection established, missing tables synchronized, and default configuration seeded');
}
