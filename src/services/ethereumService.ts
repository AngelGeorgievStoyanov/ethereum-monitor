import { createBlockMonitorService } from './blockMonitorService';
export { matchesTxFilter } from '../utils/matchesTxFilter';

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
