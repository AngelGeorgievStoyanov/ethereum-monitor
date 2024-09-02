import * as dotenv from 'dotenv';
dotenv.config();

export const configInfura = {
    infuraProjectId: process.env.INFURA_PROJECT_ID || '',
    databaseUrl: process.env.DATABASE_URL || 'sqlite:./db.sqlite',
};
