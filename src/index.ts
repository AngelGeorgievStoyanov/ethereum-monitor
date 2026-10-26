import express from 'express';
import './models/associations';
import sequelize from './database';
import httpRouter from './httpRouter';
import { HTTP_HOST, HTTP_PORT } from './constants/http.constants';
import {
    SCANNER_START_RETRY_BASE_DELAY_MS,
    SCANNER_START_RETRY_MAX_DELAY_MS,
} from './constants/scanner.constants';
import { getEthereumService } from './services/ethereumService';
import { getTxFilterService } from './services/txFilterService';
import { formatError } from './utils/formatError';
import { sleep } from './utils/sleep';
import { ensureTransferUniqueness } from './repositories/transactionRepository';

const app = express();

const ethereumService = getEthereumService();
const txFilterService = getTxFilterService();

app.use(express.json());
app.use('/api', httpRouter);

async function startScannerWithRetry() {
    let attempt = 0;

    while (true) {
        try {
            await ethereumService.start();
            return;
        } catch (error) {
            attempt += 1;
            const delayMs = Math.min(
                SCANNER_START_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
                SCANNER_START_RETRY_MAX_DELAY_MS,
            );

            console.error(
                `[Scanner] Startup failed (attempt ${attempt}); retrying in ${delayMs}ms: ${formatError(error)}`,
            );
            await sleep(delayMs);
        }
    }
}

async function startServer() {
    await sequelize.sync();
    console.log('Database connected');

    await ensureTransferUniqueness();
    console.log('Transfer uniqueness constraints verified');

    await txFilterService.loadTxFilters();

    void startScannerWithRetry();

    const server = app.listen(HTTP_PORT, HTTP_HOST, () => {
        console.log(`Server is running on http://${HTTP_HOST}:${HTTP_PORT}`);
    });

    server.on('error', (error) => {
        console.error(`Server error: ${formatError(error)}`);
    });
}

startServer();
