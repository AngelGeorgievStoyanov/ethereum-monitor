import { createBlockMonitorService } from './blockMonitorService';
export { matchesConfiguration } from '../utils/matchesConfiguration';

let ethereumServiceInstance: ReturnType<typeof createBlockMonitorService> | undefined;

export function createEthereumService() {
    return createBlockMonitorService();
}

export function getEthereumService() {
    if (!ethereumServiceInstance) {
        ethereumServiceInstance = createEthereumService();
    }
    return ethereumServiceInstance;
}
