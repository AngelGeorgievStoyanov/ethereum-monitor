import { createHash } from 'node:crypto';
import type { DynamicSettings } from '../constants/dynamic-settings.constants';
import {
    DYNAMIC_CONFIG_FAST_REFRESH_INTERVAL_MS,
    DYNAMIC_CONFIG_SLOW_REFRESH_INTERVAL_MS,
} from '../constants/dynamic-config.constants';
import { TX_FILTER_RELOAD_RETRY_DELAYS_MS } from '../constants/tx-filter.constants';
import type { ActiveTxFilter, ActiveTxFilterConfig } from '../types/tx-filter.types';
import { getConfigurationService } from './configurationService';
import { getTxFilterService } from './txFilterService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';

export function createDynamicConfigService() {
    const txFilterService = getTxFilterService();
    const configurationService = getConfigurationService();
    let activeTxFilters = new Map<number, ActiveTxFilter>();
    let activeTxFilterVersion = '';
    let reloadQueue: Promise<boolean> = Promise.resolve(true);
    let fastRefreshTimer: ReturnType<typeof setInterval> | undefined;
    let slowRefreshTimer: ReturnType<typeof setInterval> | undefined;
    let pendingReloadCount = 0;
    let slowRefreshInProgress = false;
    let initialized = false;
    let currentMetrics: Record<string, unknown> | null = null;
    let scannerStatus: unknown = null;
    let scannerPaused: boolean | null = null;

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
        const nextVersion = createHash('sha256').update(configSignature).digest('hex').slice(0, 16);

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

    async function refreshTxFiltersWithRetry(): Promise<boolean> {
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

    async function refreshSlowData(): Promise<void> {
        if (slowRefreshInProgress) return;
        slowRefreshInProgress = true;

        try {
            await configurationService.refresh();
            if (!(await refreshTxFiltersWithRetry())) {
                console.error(
                    '[DynamicConfig] Slow refresh could not reload transaction filters; keeping the last valid filter configuration',
                );
            }
        } finally {
            slowRefreshInProgress = false;
        }
    }

    function startFastRefresh(): void {
        if (fastRefreshTimer) return;

        fastRefreshTimer = setInterval(() => {
            if (pendingReloadCount === 0 && !slowRefreshInProgress) {
                void refreshTxFiltersWithRetry();
            }
        }, DYNAMIC_CONFIG_FAST_REFRESH_INTERVAL_MS);
        fastRefreshTimer.unref?.();

        console.log(
            `[DynamicConfig] Fast refresh scheduled every ${DYNAMIC_CONFIG_FAST_REFRESH_INTERVAL_MS}ms`,
        );
    }

    function startSlowRefresh(): void {
        if (slowRefreshTimer) return;

        slowRefreshTimer = setInterval(() => {
            if (pendingReloadCount === 0 && !slowRefreshInProgress) {
                void refreshSlowData();
            }
        }, DYNAMIC_CONFIG_SLOW_REFRESH_INTERVAL_MS);
        slowRefreshTimer.unref?.();

        console.log(
            `[DynamicConfig] Slow refresh scheduled every ${DYNAMIC_CONFIG_SLOW_REFRESH_INTERVAL_MS}ms`,
        );
    }

    async function init(): Promise<void> {
        if (fastRefreshTimer || slowRefreshTimer) return;

        // Load all dynamic configuration before scheduling either refresh interval.
        await configurationService.refresh();
        if (!(await refreshTxFiltersWithRetry())) {
            throw new Error(
                'Unable to load required dynamic configuration; scanner startup is blocked',
            );
        }

        startFastRefresh();
        startSlowRefresh();
    }

    function stopRefreshTimers(): void {
        if (fastRefreshTimer) {
            clearInterval(fastRefreshTimer);
            fastRefreshTimer = undefined;
        }
        if (slowRefreshTimer) {
            clearInterval(slowRefreshTimer);
            slowRefreshTimer = undefined;
        }
    }

    function getActiveTxFilterConfig(): ActiveTxFilterConfig {
        if (!initialized) throw new Error('Dynamic configuration has not been initialized');
        return {
            version: activeTxFilterVersion,
            filters: Array.from(activeTxFilters.values()),
        };
    }

    function getDynamicSettings(): DynamicSettings {
        return configurationService.getDynamicSettings();
    }

    function getTxFilters(): ActiveTxFilter[] {
        return getActiveTxFilterConfig().filters;
    }

    // Current metrics are passively stored and returned; calculations belong to the aggregator.
    function publishMetrics(metrics: Record<string, unknown>): void {
        currentMetrics = metrics;
    }

    function getCurrentMetrics(): Record<string, unknown> | null {
        return currentMetrics;
    }

    function publishScannerControlState(paused: boolean): void {
        scannerPaused = paused;
        updateScannerStatus({ paused });
    }

    function getScannerPaused(): boolean {
        if (scannerPaused === null) {
            throw new Error('Scanner control configuration has not been initialized');
        }
        return scannerPaused;
    }

    function publishScannerStatus(status: unknown): void {
        scannerStatus = status;
    }

    function getScannerStatus(): unknown {
        return scannerStatus;
    }

    // Dynamic Config remains a passive in-memory state store; callers own all state calculations.
    function updateScannerStatus(patch: Record<string, unknown>): void {
        if (!scannerStatus || typeof scannerStatus !== 'object') return;
        scannerStatus = {
            ...scannerStatus,
            ...patch,
            checkedAt: new Date().toISOString(),
        };
    }

    txFilterService.setDynamicConfigRefreshHandler(refreshTxFiltersWithRetry);
    return {
        init,
        refreshTxFiltersWithRetry,
        stopRefreshTimers,
        getTxFilters,
        getDynamicSettings,
        getActiveTxFilterConfig,
        publishMetrics,
        getCurrentMetrics,
        publishScannerControlState,
        getScannerPaused,
        publishScannerStatus,
        getScannerStatus,
        updateScannerStatus,
    };
}

let dynamicConfigServiceInstance: ReturnType<typeof createDynamicConfigService> | undefined;

export function getDynamicConfigService() {
    if (!dynamicConfigServiceInstance) dynamicConfigServiceInstance = createDynamicConfigService();
    return dynamicConfigServiceInstance;
}
