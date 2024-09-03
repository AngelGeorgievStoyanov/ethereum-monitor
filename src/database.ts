import { Sequelize } from 'sequelize';
import * as dotenv from 'dotenv';
import Configuration from './models/configuration';
import Transaction from './models/transaction';

dotenv.config();

const sequelize = new Sequelize(process.env.DATABASE_URL || 'sqlite:./db.sqlite', {
  dialect: 'sqlite',
  logging: false,
});

export default sequelize;
