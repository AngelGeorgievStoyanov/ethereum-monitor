import * as dotenv from 'dotenv';
dotenv.config();

const infuraProjectId = process.env.INFURA_PROJECT_ID || '';

export const configInfura = {
    infuraProjectId,
    infuraWebsocketUrl: process.env.INFURA_WEBSOCKET_URL || `wss://mainnet.infura.io/ws/v3/${infuraProjectId}`,
    databaseUrl: process.env.DATABASE_URL || 'sqlite:./db.sqlite',
};
