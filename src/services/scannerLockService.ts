import sequelize from '../database';
import { SCANNER_ADVISORY_LOCK_KEY } from '../constants/scanner.constants';

let lockConnection: any;

export async function tryAcquireScannerLock(): Promise<boolean> {
    if (lockConnection) return true;

    const connectionManager = (sequelize as any).connectionManager;
    const connection = await connectionManager.getConnection({
        type: 'WRITE',
        useMaster: true,
    });

    try {
        const result = await connection.query(
            'SELECT pg_try_advisory_lock($1) AS locked',
            [SCANNER_ADVISORY_LOCK_KEY],
        );
        const acquired = result.rows?.[0]?.locked === true;

        if (acquired) {
            // Keep this connection checked out: PostgreSQL session advisory locks are
            // released when the connection closes or is returned to the pool.
            lockConnection = connection;
            return true;
        }

        await connectionManager.releaseConnection(connection);
        return false;
    } catch (error) {
        await connectionManager.releaseConnection(connection);
        throw error;
    }
}
