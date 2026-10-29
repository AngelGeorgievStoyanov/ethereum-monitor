import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';

function getDatabaseDetails(): { databaseName: string; adminDatabaseUrl: string } {
    const databaseUrl = new URL(env.databaseUrl);
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));

    if (!databaseName) {
        throw new Error('DATABASE_URL must include a PostgreSQL database name');
    }

    const adminDatabaseUrl = new URL(databaseUrl);
    adminDatabaseUrl.pathname = '/postgres';

    return {
        databaseName,
        adminDatabaseUrl: adminDatabaseUrl.toString(),
    };
}

async function databaseExists(
    sequelize: Sequelize,
    databaseName: string,
): Promise<boolean> {
    const databases = await sequelize.query<{ '?column?': number }>(
        'SELECT 1 FROM pg_database WHERE datname = $databaseName',
        {
            bind: { databaseName },
            type: QueryTypes.SELECT,
        },
    );

    return databases.length > 0;
}

export async function createDatabaseIfNotExists(): Promise<void> {
    const { databaseName, adminDatabaseUrl } = getDatabaseDetails();
    const adminConnection = new Sequelize(adminDatabaseUrl, {
        dialect: 'postgres',
        logging: false,
    });

    try {
        await adminConnection.authenticate();

        if (await databaseExists(adminConnection, databaseName)) {
            return;
        }

        const quotedDatabaseName = '"' + databaseName.replace(/"/g, '""') + '"';

        try {
            await adminConnection.query('CREATE DATABASE ' + quotedDatabaseName);
            console.log('[Database] Created database "' + databaseName + '"');
        } catch (error) {
            if (await databaseExists(adminConnection, databaseName)) {
                return;
            }

            throw error;
        }
    } finally {
        await adminConnection.close();
    }
}
