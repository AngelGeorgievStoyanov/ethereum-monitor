import { Sequelize } from 'sequelize';
import { env } from './config/env';

const sequelize = new Sequelize(env.databaseUrl, {
    dialect: 'sqlite',
    logging: false,
});

export default sequelize;
