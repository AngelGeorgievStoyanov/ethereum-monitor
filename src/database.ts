import { Sequelize } from 'sequelize';
import { env } from './config/env';

const databaseUrl = new URL(env.databaseUrl);
databaseUrl.pathname = '/' + env.blockchainNetworkAndDatabaseName;

const sequelize = new Sequelize(databaseUrl.toString(), {
    dialect: 'postgres',
    logging: false,
});

export default sequelize;
