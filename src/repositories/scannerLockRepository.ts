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
    destroyConnection(connection: PgConnection): Promise<void>;
}

let lockConnection: PgConnection | undefined;

const connectionManager = sequelize.connectionManager as unknown as ConnectionManager;

async function releaseConnection(connection: PgConnection): Promise<void> {
    try {
        await connectionManager.releaseConnection(connection);
    } catch {
        // The pool may already have discarded the connection.
    }
}

async function destroyConnection(connection: PgConnection): Promise<void> {
    try {
        await connectionManager.destroyConnection(connection);
    } catch {
        // Destroying a dead connection may itself fail.
    }
}

async function discardLockConnection(destroy: boolean): Promise<void> {
    const connection = lockConnection;
    lockConnection = undefined;

    if (!connection) return;

    if (destroy) {
        // If lock state is uncertain, terminate the PostgreSQL session instead of
        // returning a potentially lock-holding connection to the pool.
        await destroyConnection(connection);
        return;
    }

    await releaseConnection(connection);
}

export async function isScannerLockHeld(): Promise<boolean> {
    const connection = lockConnection;
    if (!connection) return false;

    try {
        const result = await connection.query(
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

        await discardLockConnection(false);
        return false;
    } catch (error) {
        console.warn(
            `[Scanner] Advisory lock connection check failed; discarding connection and reacquiring lock: ${String(error)}`,
        );
        await discardLockConnection(true);
        return false;
    }
}

export async function tryAcquireScannerLock(): Promise<boolean> {
    if (await isScannerLockHeld()) return true;

    const connection = await connectionManager.getConnection({
        type: 'WRITE',
        useMaster: true,
    });

    try {
        const result = await connection.query('SELECT pg_try_advisory_lock($1) AS locked', [
            SCANNER_ADVISORY_LOCK_KEY,
        ]);
        const acquired = result.rows?.[0]?.locked === true;

        if (acquired) {
            // Session-level advisory locks require retaining this exact connection.
            lockConnection = connection;
            return true;
        }

        await releaseConnection(connection);
        return false;
    } catch (error) {
        // The query may have acquired the lock even if its response was lost.
        // Destroying the session guarantees PostgreSQL releases any session lock.
        await destroyConnection(connection);
        throw error;
    }
}

export async function releaseScannerLock(): Promise<void> {
    const connection = lockConnection;
    if (!connection) return;

    try {
        const result = await connection.query('SELECT pg_advisory_unlock($1) AS locked', [
            SCANNER_ADVISORY_LOCK_KEY,
        ]);

        if (result.rows?.[0]?.locked !== true) {
            await discardLockConnection(true);
            return;
        }

        await discardLockConnection(false);
    } catch (error) {
        await discardLockConnection(true);
        throw error;
    }
}
