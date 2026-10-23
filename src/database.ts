import { Sequelize } from 'sequelize';
import { env } from './config/env';
import './models/configuration';
import './models/transaction';
import './models/scannerState';

const sequelize = new Sequelize(env.databaseUrl, {
    dialect: 'sqlite',
    logging: false,
});

export default sequelize;
