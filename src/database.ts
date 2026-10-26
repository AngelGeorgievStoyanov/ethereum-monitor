import { Sequelize } from 'sequelize';
import { env } from './config/env';

const sequelize = new Sequelize(env.databaseUrl, {
    dialect: 'postgres',
    logging: false,
});

export default sequelize;
