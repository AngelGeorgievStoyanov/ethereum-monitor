import express from 'express';
import sequelize from './database';
import configRoutes from './routes/configRoutes';
import { getEthereumService } from './services/ethereumService';
import { getConfigurationService } from './services/configurationService';
import { formatError } from './utils/formatError';
import transactionRoutes from './routes/transactionRoutes';

const app = express();
const PORT = 8000;
const HOST = 'localhost';

const ethereumService = getEthereumService();
const configurationService = getConfigurationService();

app.use(express.json());

async function startServer() {
    await sequelize.sync({ alter: true });
    console.log('Database connected');

    app.use('/api/configurations', configRoutes);
    app.use('/api/transactions', transactionRoutes);
    await configurationService.loadConfigurations();

    void ethereumService.start().catch(error => {
        console.error(`[Scanner] Unable to start: ${formatError(error)}`);
    });

    app.listen(PORT, () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
    });
}

startServer();

app.on('error', error => {
    console.error(`Server error: ${formatError(error)}`);
});
