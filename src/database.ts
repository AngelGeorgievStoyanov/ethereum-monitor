import { Sequelize } from 'sequelize';
import { configInfura } from './config/config';


const sequelize = new Sequelize(configInfura.databaseUrl, {
  dialect: 'sqlite',
  logging: false,
});

export default sequelize;
