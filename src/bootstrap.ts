import app from './app';
import sequelize from './database';
import { HTTP_HOST, HTTP_PORT } from './constants/http.constants';
import { initializeDatabase } from './database/initializeDatabase';
import { getBlockMonitorService } from './services/blockMonitorServiceFactory';
import { getDynamicConfigService } from './services/dynamicConfigService';
import { refreshScannerStatus } from './services/scannerStatusService';
import {
    initScannerControlRefresh,
    stopScannerControlRefresh,
} from './services/scannerControlService';
import { formatError } from './utils/formatError';
import { runNetworkCheck } from './checks/networkCheck';
import { runRpcCompatibilityCheck } from './checks/rpcCompatibilityCheck';

export async function startApplication(): Promise<void> {
    let dynamicConfigService: ReturnType<typeof getDynamicConfigService> | undefined;

    try {
        await runNetworkCheck();
        await runRpcCompatibilityCheck();
        await initializeDatabase();

        dynamicConfigService = getDynamicConfigService();
        await dynamicConfigService.init();
        await initScannerControlRefresh();
        await refreshScannerStatus();

        const blockMonitorService = getBlockMonitorService();
        const server = app.listen(HTTP_PORT, HTTP_HOST);

        // Do not start the scanner until the HTTP server has successfully bound its port.
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.once('listening', () => {
                server.removeListener('error', reject);
                console.log(`Server is running on http://${HTTP_HOST}:${HTTP_PORT}`);
                resolve();
            });
        });

        // Errors after startup are logged locally; they must not become unhandled events.
        server.on('error', (error) => {
            console.error(`[HTTP] Server error after startup: ${formatError(error)}`);
        });

        void blockMonitorService.start().catch((error) => {
            console.error(`[Scanner] Startup failed; stopping process: ${formatError(error)}`);
            process.exit(1);
        });

        process.once('beforeExit', () => {
            dynamicConfigService?.stopRefreshTimers();
            stopScannerControlRefresh();
        });
    } catch (error) {
        dynamicConfigService?.stopRefreshTimers();
        stopScannerControlRefresh();
        await sequelize.close().catch(() => undefined);
        console.error(`[Startup] Application failed to start: ${formatError(error)}`);
        process.exitCode = 1;
    }
}
