import express from 'express';
import sequelize from './database';
import httpRouter from './httpRouter';
import { HTTP_HOST, HTTP_PORT } from './constants/http.constants';
import { getEthereumService } from './services/ethereumService';
import { getConfigurationService } from './services/configurationService';
import { formatError } from './utils/formatError';

const app = express();

const ethereumService = getEthereumService();
const configurationService = getConfigurationService();

app.use(express.json());
app.use('/api', httpRouter);

async function startServer() {
    await sequelize.sync();
    console.log('Database connected');

    await configurationService.loadConfigurations();

    void ethereumService.start().catch(error => {
        console.error(`[Scanner] Unable to start: ${formatError(error)}`);
    });

    app.listen(HTTP_PORT, HTTP_HOST, () => {
        console.log(`Server is running on http://${HTTP_HOST}:${HTTP_PORT}`);
    });
}

startServer();

app.on('error', error => {
    console.error(`Server error: ${formatError(error)}`);
});
