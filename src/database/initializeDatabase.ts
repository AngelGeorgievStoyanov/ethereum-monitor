import '../models/registerModels';
import sequelize from '../database';
import Configuration from '../models/configuration';
import { getDefaultConfigurationRows } from '../mappers/configurationMapper';
import { createDatabaseIfNotExists } from './createDatabaseIfNotExists';

export async function initializeDatabase(): Promise<void> {
    await createDatabaseIfNotExists();
    await sequelize.authenticate();
    await sequelize.sync();

    await Configuration.bulkCreate(getDefaultConfigurationRows(), {
        ignoreDuplicates: true,
    });

    console.log('[Database] Connection established and missing tables synchronized');
}
