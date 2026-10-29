import express from 'express';
import './models/associations';
import './models/block';
import './models/scannerRescanJob';
import sequelize from './database';
import httpRouter from './httpRouter';
import { HTTP_HOST, HTTP_PORT } from './constants/http.constants';
import { getEthereumService } from './services/ethereumService';
import { getDynamicConfigService } from './services/dynamicConfigService';
import { formatError } from './utils/formatError';

const app = express();

const ethereumService = getEthereumService();
const dynamicConfigService = getDynamicConfigService();

app.use(express.json());
app.use('/api', httpRouter);

async function startServer() {
    await sequelize.sync();
    console.log('Database connected');

    await dynamicConfigService.init();

    void ethereumService.start().catch((error) => {
        console.error(`[Scanner] Startup failed; stopping process: ${formatError(error)}`);
        process.exit(1);
    });

    const server = app.listen(HTTP_PORT, HTTP_HOST, () => {
        console.log(`Server is running on http://${HTTP_HOST}:${HTTP_PORT}`);
    });

    server.on('error', (error) => {
        console.error(`Server error: ${formatError(error)}`);
    });
}

process.once('beforeExit', () => {
    dynamicConfigService.stopRefreshTimer();
});

startServer();
