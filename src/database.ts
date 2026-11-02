import { Sequelize } from 'sequelize';
import { env } from './config/env';
import { publishDatabaseMetricEvent } from './metrics/databaseMetricsEventBus';

const databaseUrl = new URL(env.databaseUrl);
databaseUrl.pathname = '/' + env.blockchainNetworkAndDatabaseName;

function getQueryOperation(sql: string): { operation: 'read' | 'write' | 'other'; queryType: string } {
    const queryType = sql.trim().split(/\s+/, 1)[0]?.replace(/[();]/g, '').toUpperCase() || 'UNKNOWN';
    if (['SELECT', 'SHOW', 'EXPLAIN', 'WITH'].includes(queryType)) {
        return { operation: 'read', queryType };
    }
    if (['INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'REPLACE'].includes(queryType)) {
        return { operation: 'write', queryType };
    }
    return { operation: 'other', queryType };
}

const sequelize = new Sequelize(databaseUrl.toString(), {
    dialect: 'postgres',
    benchmark: true,
    logging: (sql, timing) => {
        if (typeof timing !== 'number' || !Number.isFinite(timing) || timing < 0) return;
        const query = getQueryOperation(sql);
        publishDatabaseMetricEvent({ ...query, durationMs: timing });
    },
});

export default sequelize;
