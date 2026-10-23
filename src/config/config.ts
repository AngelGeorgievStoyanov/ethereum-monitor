import * as dotenv from 'dotenv';
dotenv.config();

const infuraProjectId = process.env.INFURA_PROJECT_ID || '';

export const configInfura = {
    infuraProjectId,
    databaseUrl: process.env.DATABASE_URL || 'sqlite:./db.sqlite',
};
