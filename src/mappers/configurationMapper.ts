import type { DynamicSettings } from '../constants/dynamic-settings.constants';
import {
    MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_POLL_INTERVAL_MS,
} from '../constants/scanner-settings.constants';
import { METRICS_PUBLISH_INTERVAL_MS } from '../constants/scanner-metrics.constants';

const POSITIVE_INTEGER_DEFAULTS: Record<string, number> = {
    pollIntervalMs: SCANNER_POLL_INTERVAL_MS,
    maxBlocksPerCatchup: MAX_BLOCKS_PER_FINALIZED_CATCHUP,
    maxParallelBlocks: SCANNER_MAX_PARALLEL_BLOCKS,
    publishIntervalMs: METRICS_PUBLISH_INTERVAL_MS,
};

function normalizeSetting(settingKey: string, value: string): string {
    const fallback = POSITIVE_INTEGER_DEFAULTS[settingKey];
    if (fallback === undefined) return value;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        console.warn(`[Configuration] Invalid ${settingKey}="${value}"; using default ${fallback}`);
        return String(fallback);
    }
    return String(parsed);
}

export interface ConfigurationRow {
    settingKey: string;
    value: string;
}

export function mapConfigurationRowsToDynamicSettings(rows: ConfigurationRow[]): DynamicSettings {
    return rows.reduce<DynamicSettings>((settings, row) => {
        settings[row.settingKey] = normalizeSetting(row.settingKey, row.value);
        return settings;
    }, {});
}
