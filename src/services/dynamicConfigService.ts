import { createHash } from 'node:crypto';
import sequelize from '../database';
import { QueryTypes } from 'sequelize';
import { DYNAMIC_SETTINGS_DEFAULTS, type DynamicSettings, type DynamicSettingKey } from '../constants/dynamic-settings.constants';
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
    let runtimeMetricsSnapshot: unknown = null;
    let scannerStatusSnapshot: unknown = null;
    let scannerControlPausedSnapshot: boolean | null = null;
    let dynamicSettings: DynamicSettings = { scanner: { ...DYNAMIC_SETTINGS_DEFAULTS.scanner }, metrics: { ...DYNAMIC_SETTINGS_DEFAULTS.metrics } };

    function getDynamicSetting(settings: DynamicSettings, key: DynamicSettingKey): number {
        const [section, setting] = key.split('.') as ['scanner' | 'metrics', string];
        return (settings[section] as Record<string, number>)[setting];
    }
    function setDynamicSetting(settings: DynamicSettings, key: DynamicSettingKey, value: number): void {
        const [section, setting] = key.split('.') as ['scanner' | 'metrics', string];
        (settings[section] as Record<string, number>)[setting] = value;
    }
    function parseDynamicSettingValue(key: DynamicSettingKey, rawValue: string): number | null {
        const value = Number(rawValue);
        if (!Number.isSafeInteger(value) || value <= 0) return null;
        if (key === 'scanner.maxParallelBlocks' && value > 32) return null;
        if (key === 'scanner.parallelProcessingLagBlocks' && value > 1000000) return null;
        if (key === 'scanner.maxBlocksPerCatchup' && value > 100000) return null;
        if ((key.endsWith('IntervalMs') || key.endsWith('RefreshMs')) && value < 100) return null;
        return value;
    }

    async function loadDynamicSettings(): Promise<void> {
        try {
            const rows = await sequelize.query<{ settingKey: string; value: string }>(
                'SELECT "settingKey", value FROM "Configurations"',
                { type: QueryTypes.SELECT },
            );
            const next: DynamicSettings = { scanner: { ...DYNAMIC_SETTINGS_DEFAULTS.scanner }, metrics: { ...DYNAMIC_SETTINGS_DEFAULTS.metrics } };
            for (const row of rows) {
                const key = row.settingKey as DynamicSettingKey;
                if (!['scanner.maxParallelBlocks', 'scanner.parallelProcessingLagBlocks', 'scanner.maxBlocksPerCatchup', 'scanner.pollIntervalMs', 'metrics.publishIntervalMs', 'metrics.analyticsRefreshMs'].includes(key)) continue;
                const parsedValue = parseDynamicSettingValue(key, row.value);
                if (parsedValue === null) {
                    console.warn(`[DynamicConfig] Invalid value for "${key}"; keeping previous valid value`);
                    setDynamicSetting(next, key, getDynamicSetting(dynamicSettings, key));
                    continue;
                }
                setDynamicSetting(next, key, parsedValue);
            }
            dynamicSettings = next;
            console.log(`[DynamicConfig] Loaded dynamic settings; rows=${rows.length}`);
        } catch (error) {
            console.error(`[DynamicConfig] Dynamic settings refresh failed; keeping last valid settings: ${formatError(error)}`);
        }
    }

    async function loadTxFilters(): Promise<void> {
        await loadDynamicSettings();
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

    function getDynamicSettings(): DynamicSettings { return { scanner: { ...dynamicSettings.scanner }, metrics: { ...dynamicSettings.metrics } }; }

    function getTxFilters(): ActiveTxFilter[] {
        return getTxFilterSnapshot().filters;
    }

    // Runtime metrics are passively stored and returned; calculations belong to the aggregator.
    function publishRuntimeMetrics(snapshot: unknown): void {
        runtimeMetricsSnapshot = snapshot;
    }

    function getRuntimeMetricsSnapshot(): unknown {
        return runtimeMetricsSnapshot;
    }

    function publishScannerControlSnapshot(paused: boolean): void {
        scannerControlPausedSnapshot = paused;
        updateScannerStatusSnapshot({ paused });
    }

    function getScannerControlSnapshot(): boolean {
        if (scannerControlPausedSnapshot === null) {
            throw new Error('Scanner control configuration has not been initialized');
        }
        return scannerControlPausedSnapshot;
    }

    function publishScannerStatus(snapshot: unknown): void {
        scannerStatusSnapshot = snapshot;
    }

    function getScannerStatusSnapshot(): unknown {
        return scannerStatusSnapshot;
    }

    // Dynamic Config remains a passive in-memory snapshot store; callers own all state calculations.
    function updateScannerStatusSnapshot(patch: Record<string, unknown>): void {
        if (!scannerStatusSnapshot || typeof scannerStatusSnapshot !== 'object') return;
        scannerStatusSnapshot = {
            ...scannerStatusSnapshot,
            ...patch,
            checkedAt: new Date().toISOString(),
        };
    }

    txFilterService.setDynamicConfigRefreshHandler(refreshWithRetry);
    return {
        init,
        refreshWithRetry,
        stopRefreshTimer,
        getTxFilters,
        getDynamicSettings,
        getTxFilterSnapshot,
        publishRuntimeMetrics,
        getRuntimeMetricsSnapshot,
        publishScannerControlSnapshot,
        getScannerControlSnapshot,
        publishScannerStatus,
        getScannerStatusSnapshot,
        updateScannerStatusSnapshot,
    };
}

let dynamicConfigServiceInstance: ReturnType<typeof createDynamicConfigService> | undefined;

export function getDynamicConfigService() {
    if (!dynamicConfigServiceInstance) dynamicConfigServiceInstance = createDynamicConfigService();
    return dynamicConfigServiceInstance;
}
