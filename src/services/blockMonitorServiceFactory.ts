import { createBlockMonitorService } from './blockMonitorService';
export { matchesTxFilter } from '../utils/matchesTxFilter';

let blockMonitorServiceInstance: ReturnType<typeof createBlockMonitorService> | undefined;

export function createBlockMonitorService() {
    return createBlockMonitorService();
}

export function getBlockMonitorService() {
    if (!blockMonitorServiceInstance) {
        blockMonitorServiceInstance = createBlockMonitorService();
    }
    return blockMonitorServiceInstance;
}
