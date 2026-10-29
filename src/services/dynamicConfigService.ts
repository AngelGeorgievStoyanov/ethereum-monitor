import { TX_FILTER_CACHE_REFRESH_INTERVAL_MS, TX_FILTER_RELOAD_RETRY_DELAYS_MS } from '../constants/tx-filter.constants';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';

export function createDynamicConfigService() {
    const txFilterService = getTxFilterService();
    let activeTxFilters = new Map<number, ActiveTxFilter>();
    let reloadQueue: Promise<boolean> = Promise.resolve(true);
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let pendingReloadCount = 0;
    let initialized = false;

    async function loadTxFilters(): Promise<void> {
        const loadedFilters = await txFilterService.loadActiveTxFilters();
        const next = new Map<number, ActiveTxFilter>(loadedFilters.map((filter): [number, ActiveTxFilter] => [filter.id, filter]));
        const signature = (map: Map<number, ActiveTxFilter>) => JSON.stringify(Array.from(map.entries()).sort(([a], [b]) => a - b));
        if (signature(activeTxFilters) === signature(next)) {
            console.log(`[DynamicConfig] Transaction filter cache unchanged (${activeTxFilters.size} active filter(s))`);
            initialized = true;
            return;
        }
        activeTxFilters = next;
        initialized = true;
        console.log(`[DynamicConfig] Loaded ${activeTxFilters.size} active transaction filter(s)`);
    }
    async function refreshWithRetry(): Promise<boolean> {
        pendingReloadCount += 1;
        const task = reloadQueue.catch(() => false).then(async () => {
            for (let attempt = 0; attempt <= TX_FILTER_RELOAD_RETRY_DELAYS_MS.length; attempt += 1) {
                try { await loadTxFilters(); return true; }
                catch (error) {
                    if (attempt === TX_FILTER_RELOAD_RETRY_DELAYS_MS.length) {
                        console.error(`[DynamicConfig] Failed to refresh transaction filters after ${attempt + 1} attempt(s): ${formatError(error)}`);
                        return false;
                    }
                    console.error(`[DynamicConfig] Refresh failed (attempt ${attempt + 1}/${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1}); retrying: ${formatError(error)}`);
                    await sleep(TX_FILTER_RELOAD_RETRY_DELAYS_MS[attempt]);
                }
            }
            return false;
        });
        const settled = task.finally(() => { pendingReloadCount -= 1; });
        reloadQueue = settled;
        return settled;
    }
    async function loadInitialConfig(): Promise<void> {
        if (!(await refreshWithRetry())) throw new Error('Unable to load required dynamic configuration; scanner startup is blocked');
    }
    function startRefreshTimer(intervalMs = TX_FILTER_CACHE_REFRESH_INTERVAL_MS): void {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => { if (pendingReloadCount === 0) void refreshWithRetry(); }, intervalMs);
        refreshTimer.unref?.();
        console.log(`[DynamicConfig] Refresh scheduled every ${intervalMs}ms`);
    }
    function stopRefreshTimer(): void {
        if (!refreshTimer) return;
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    function getTxFilters(): ActiveTxFilter[] {
        if (!initialized) throw new Error('Dynamic configuration has not been initialized');
        return Array.from(activeTxFilters.values());
    }
    txFilterService.setDynamicConfigRefreshHandler(refreshWithRetry);
    return { loadInitialConfig, refreshWithRetry, startRefreshTimer, stopRefreshTimer, getTxFilters };
}
let dynamicConfigServiceInstance: ReturnType<typeof createDynamicConfigService> | undefined;
export function getDynamicConfigService() {
    if (!dynamicConfigServiceInstance) dynamicConfigServiceInstance = createDynamicConfigService();
    return dynamicConfigServiceInstance;
}
