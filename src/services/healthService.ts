import sequelize from '../database';
import { ethereumProvider } from './ethereumRpcService';

export interface HealthReadinessResult {
    ready: boolean;
    checks: {
        database: boolean;
        rpc: boolean;
    };
}

export async function getReadinessResult(): Promise<HealthReadinessResult> {
    const [databaseCheck, rpcCheck] = await Promise.allSettled([
        sequelize.authenticate(),
        ethereumProvider.getBlock('finalized'),
    ]);

    const database = databaseCheck.status === 'fulfilled';
    const rpc = rpcCheck.status === 'fulfilled' && rpcCheck.value !== null;

    return {
        ready: database && rpc,
        checks: { database, rpc },
    };
}
