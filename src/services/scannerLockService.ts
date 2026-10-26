import sequelize from '../database';
import { SCANNER_ADVISORY_LOCK_KEY } from '../constants/scanner.constants';

interface PgConnection {
    query(
        sql: string,
        values?: unknown[],
    ): Promise<{ rows?: Array<{ locked?: boolean }> }>;
}

interface ConnectionManager {
    getConnection(options: { type: 'WRITE'; useMaster: boolean }): Promise<PgConnection>;
    releaseConnection(connection: PgConnection): Promise<void>;
}

let lockConnection: PgConnection | undefined;

async function clearLockConnection(): Promise<void> {
    const connection = lockConnection;
    lockConnection = undefined;

    if (!connection) return;

    const connectionManager = sequelize.connectionManager as unknown as ConnectionManager;

    try {
        await connectionManager.releaseConnection(connection);
    } catch {
        // The connection may already have been terminated by the database or pool.
    }
}

export async function isScannerLockHeld(): Promise<boolean> {
    if (!lockConnection) return false;

    try {
        const result = await lockConnection.query(
            `SELECT EXISTS (
                SELECT 1
                FROM pg_locks
                WHERE locktype = 'advisory'
                  AND pid = pg_backend_pid()
                  AND classid = 0::oid
                  AND objid = $1::oid
                  AND objsubid = 1
                  AND granted
            ) AS locked`,
            [SCANNER_ADVISORY_LOCK_KEY],
        );

        if (result.rows?.[0]?.locked === true) return true;

        await clearLockConnection();
        return false;
    } catch (error) {
        console.warn(
            `[Scanner] Advisory lock connection check failed; lock must be reacquired: ${String(error)}`,
        );
        await clearLockConnection();
        return false;
    }
}

export async function tryAcquireScannerLock(): Promise<boolean> {
    if (await isScannerLockHeld()) return true;

    const connectionManager = sequelize.connectionManager as unknown as ConnectionManager;
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
