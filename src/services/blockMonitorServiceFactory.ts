import { createBlockMonitorService as buildBlockMonitorService } from './blockMonitorService';
export { matchesTxFilter } from '../utils/matchesTxFilter';

let blockMonitorServiceInstance: ReturnType<typeof buildBlockMonitorService> | undefined;

export function createBlockMonitorService() {
    return buildBlockMonitorService();
}

export function getBlockMonitorService() {
    if (!blockMonitorServiceInstance) {
        blockMonitorServiceInstance = createBlockMonitorService();
    }
    return blockMonitorServiceInstance;
}
