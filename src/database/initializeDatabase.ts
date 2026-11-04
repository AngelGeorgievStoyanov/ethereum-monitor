import '../models/registerModels';
import sequelize from '../database';
import { createDatabaseIfNotExists } from './createDatabaseIfNotExists';

export async function initializeDatabase(): Promise<void> {
    await createDatabaseIfNotExists();
    await sequelize.authenticate();
    await sequelize.sync();

    console.log('[Database] Connection established and missing tables synchronized');
}
