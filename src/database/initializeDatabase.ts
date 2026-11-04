import '../models/registerModels';
import sequelize from '../database';
import { QueryTypes } from 'sequelize';
import { RUNTIME_CONFIG_DEFAULTS } from '../constants/runtime-config.constants';
import { createDatabaseIfNotExists } from './createDatabaseIfNotExists';

export async function initializeDatabase(): Promise<void> {
    await createDatabaseIfNotExists();
    await sequelize.authenticate();
    await sequelize.sync();
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS "Configurations" (
            id SERIAL PRIMARY KEY,
            "settingKey" VARCHAR(150) NOT NULL UNIQUE,
            value TEXT NOT NULL,
            description VARCHAR(500)
        )
    `);
    const countRows = await sequelize.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "Configurations"',
        { type: QueryTypes.SELECT },
    );
    if (Number(countRows[0]?.count ?? 0) === 0) {
        const descriptions: Record<keyof typeof RUNTIME_CONFIG_DEFAULTS, string> = {
            'scanner.maxParallelBlocks': 'Maximum number of blocks processed in parallel',
            'scanner.parallelProcessingLagBlocks': 'Lag threshold that enables parallel block processing',
            'scanner.maxBlocksPerCatchup': 'Maximum finalized blocks included in one catch-up iteration',
            'scanner.pollIntervalMs': 'Interval between finalized block polling attempts',
            'metrics.publishIntervalMs': 'Minimum delay between metrics snapshot publications',
            'metrics.analyticsRefreshMs': 'Cache refresh interval for metrics analytics',
        };
        const entries = Object.entries(RUNTIME_CONFIG_DEFAULTS);
        const replacements: Record<string, string> = {};
        const tuples = entries.map(([settingKey, value], index) => {
            replacements[`key${index}`] = settingKey;
            replacements[`value${index}`] = String(value);
            replacements[`description${index}`] = descriptions[settingKey as keyof typeof RUNTIME_CONFIG_DEFAULTS];
            return `(:key${index}, :value${index}, :description${index})`;
        });
        await sequelize.query(
            `INSERT INTO "Configurations" ("settingKey", value, description) VALUES ${tuples.join(', ')}`,
            { replacements },
        );
        console.log(`[Configurations] Seeded ${entries.length} default setting(s)`);
    }

    console.log('[Database] Connection established and missing tables synchronized');
}
