import { createHash } from 'node:crypto';
import {
    TX_FILTER_CACHE_REFRESH_INTERVAL_MS,
    TX_FILTER_RELOAD_RETRY_DELAYS_MS,
} from '../constants/tx-filter.constants';
import type { ActiveTxFilter, TxFilterConfigSnapshot } from '../types/tx-filter.types';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';

export function createDynamicConfigService() {
    const txFilterService = getTxFilterService();
    let activeTxFilters = new Map<number, ActiveTxFilter>();
    let activeTxFilterVersion = '';
    let reloadQueue: Promise<boolean> = Promise.resolve(true);
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let pendingReloadCount = 0;
    let initialized = false;

    async function loadTxFilters(): Promise<void> {
        const loadedFilters = await txFilterService.loadActiveTxFilters();
        const next = new Map<number, ActiveTxFilter>(
            loadedFilters.map((filter): [number, ActiveTxFilter] => [filter.id, filter]),
        );
        const configSignature = JSON.stringify(
            Array.from(next.values()).map(({ id, description, ruleSignature }) => ({
                id,
                description,
                ruleSignature,
            })),
        );
        const nextVersion = createHash('sha256')
            .update(configSignature)
            .digest('hex')
            .slice(0, 16);

        if (nextVersion === activeTxFilterVersion) {
            console.log(
                `[DynamicConfig] Filter config unchanged; version=${activeTxFilterVersion}; filters=${activeTxFilters.size}`,
            );
            initialized = true;
            return;
        }

        activeTxFilters = next;
        activeTxFilterVersion = nextVersion;
        initialized = true;
        console.log(
            `[DynamicConfig] Applied transaction filter config; version=${activeTxFilterVersion}; filters=${activeTxFilters.size}; instancePid=${process.pid}`,
        );
    }

    async function refreshWithRetry(): Promise<boolean> {
        pendingReloadCount += 1;
        const task = reloadQueue
            .catch(() => false)
            .then(async () => {
                for (
                    let attempt = 0;
                    attempt <= TX_FILTER_RELOAD_RETRY_DELAYS_MS.length;
                    attempt += 1
                ) {
                    try {
                        await loadTxFilters();
                        return true;
                    } catch (error) {
                        if (attempt === TX_FILTER_RELOAD_RETRY_DELAYS_MS.length) {
                            console.error(
                                `[DynamicConfig] Failed to refresh transaction filters after ${attempt + 1} attempt(s): ${formatError(error)}`,
                            );
                            return false;
                        }
                        console.error(
                            `[DynamicConfig] Refresh failed (attempt ${attempt + 1}/${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1}); retrying: ${formatError(error)}`,
                        );
                        await sleep(TX_FILTER_RELOAD_RETRY_DELAYS_MS[attempt]);
                    }
                }
                return false;
            });
        const settled = task.finally(() => {
            pendingReloadCount -= 1;
        });
        reloadQueue = settled;
        return settled;
    }

    async function init(): Promise<void> {
        if (!(await refreshWithRetry())) {
            throw new Error(
                'Unable to load required dynamic configuration; scanner startup is blocked',
            );
        }
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
            if (pendingReloadCount === 0) void refreshWithRetry();
        }, TX_FILTER_CACHE_REFRESH_INTERVAL_MS);
        refreshTimer.unref?.();
        console.log(
            `[DynamicConfig] Refresh scheduled every ${TX_FILTER_CACHE_REFRESH_INTERVAL_MS}ms`,
        );
    }

    function stopRefreshTimer(): void {
        if (!refreshTimer) return;
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }

    function getTxFilterSnapshot(): TxFilterConfigSnapshot {
        if (!initialized) throw new Error('Dynamic configuration has not been initialized');
        return {
            version: activeTxFilterVersion,
            filters: Array.from(activeTxFilters.values()),
        };
    }

    function getTxFilters(): ActiveTxFilter[] {
        return getTxFilterSnapshot().filters;
    }

    txFilterService.setDynamicConfigRefreshHandler(refreshWithRetry);
    return {
        init,
        refreshWithRetry,
        stopRefreshTimer,
        getTxFilters,
        getTxFilterSnapshot,
    };
}

let dynamicConfigServiceInstance: ReturnType<typeof createDynamicConfigService> | undefined;

export function getDynamicConfigService() {
    if (!dynamicConfigServiceInstance) dynamicConfigServiceInstance = createDynamicConfigService();
    return dynamicConfigServiceInstance;
}
