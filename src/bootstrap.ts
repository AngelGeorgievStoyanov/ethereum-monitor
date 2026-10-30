import app from './app';
import sequelize from './database';
import { HTTP_HOST, HTTP_PORT } from './constants/http.constants';
import { initializeDatabase } from './database/initializeDatabase';
import { getBlockMonitorService } from './services/blockMonitorServiceFactory';
import { getDynamicConfigService } from './services/dynamicConfigService';
import { formatError } from './utils/formatError';

export async function startApplication(): Promise<void> {
    let dynamicConfigService: ReturnType<typeof getDynamicConfigService> | undefined;

    try {
        await initializeDatabase();

        dynamicConfigService = getDynamicConfigService();
        await dynamicConfigService.init();

        const blockMonitorService = getBlockMonitorService();
        const server = app.listen(HTTP_PORT, HTTP_HOST, () => {
            console.log(`Server is running on http://${HTTP_HOST}:${HTTP_PORT}`);
        });

        server.on('error', (error) => {
            console.error(`Server error: ${formatError(error)}`);
        });

        void blockMonitorService.start().catch((error) => {
            console.error(`[Scanner] Startup failed; stopping process: ${formatError(error)}`);
            process.exit(1);
        });

        process.once('beforeExit', () => {
            dynamicConfigService?.stopRefreshTimer();
        });
    } catch (error) {
        dynamicConfigService?.stopRefreshTimer();
        await sequelize.close().catch(() => undefined);
        console.error(`[Startup] Application failed to start: ${formatError(error)}`);
        process.exitCode = 1;
    }
}
