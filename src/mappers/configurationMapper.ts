import {
    DYNAMIC_SETTINGS_DEFAULTS,
    type DynamicSettingKey,
    type DynamicSettings,
} from '../constants/dynamic-settings.constants';

export interface ConfigurationRow {
    settingKey: string;
    value: string;
}

const DYNAMIC_SETTING_DESCRIPTIONS: Record<DynamicSettingKey, string> = {
    'scanner.maxParallelBlocks': 'Maximum number of blocks processed in parallel',
    'scanner.parallelProcessingLagBlocks':
        'Lag threshold that enables parallel block processing',
    'scanner.maxBlocksPerCatchup':
        'Maximum finalized blocks included in one catch-up iteration',
    'scanner.pollIntervalMs': 'Interval between finalized block polling attempts',
    'metrics.publishIntervalMs': 'Minimum delay between metrics updates',
    'metrics.analyticsRefreshMs': 'Cache refresh interval for metrics analytics',
};

const DYNAMIC_SETTING_MAX_VALUES: Partial<Record<DynamicSettingKey, number>> = {
    'scanner.maxParallelBlocks': 32,
    'scanner.parallelProcessingLagBlocks': 1_000_000,
    'scanner.maxBlocksPerCatchup': 100_000,
};

function cloneSettings(settings: DynamicSettings): DynamicSettings {
    return {
        scanner: { ...settings.scanner },
        metrics: { ...settings.metrics },
    };
}

function getSetting(settings: DynamicSettings, key: DynamicSettingKey): number {
    const [section, setting] = key.split('.') as ['scanner' | 'metrics', string];
    return (settings[section] as Record<string, number>)[setting];
}

function setSetting(settings: DynamicSettings, key: DynamicSettingKey, value: number): void {
    const [section, setting] = key.split('.') as ['scanner' | 'metrics', string];
    (settings[section] as Record<string, number>)[setting] = value;
}

function parseSettingValue(key: DynamicSettingKey, rawValue: string): number | null {
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value <= 0) return null;

    const maxValue = DYNAMIC_SETTING_MAX_VALUES[key];
    if (maxValue !== undefined && value > maxValue) return null;
    if ((key.endsWith('IntervalMs') || key.endsWith('RefreshMs')) && value < 100) return null;

    return value;
}

export function mapConfigurationRowsToDynamicSettings(
    rows: ConfigurationRow[],
    previousSettings: DynamicSettings = DYNAMIC_SETTINGS_DEFAULTS as DynamicSettings,
): DynamicSettings {
    const next = cloneSettings(DYNAMIC_SETTINGS_DEFAULTS as DynamicSettings);
    const valuesByKey = new Map(rows.map((row) => [row.settingKey, row.value]));

    for (const [section, sectionDefaults] of Object.entries(DYNAMIC_SETTINGS_DEFAULTS)) {
        for (const [setting, defaultValue] of Object.entries(sectionDefaults)) {
            const key = `${section}.${setting}` as DynamicSettingKey;
            const rawValue = valuesByKey.get(key);
            if (rawValue === undefined) continue;

            const parsedValue = parseSettingValue(key, rawValue);
            if (parsedValue === null) {
                console.warn(
                    `[Configuration] Invalid value for "${key}"; keeping previous valid value`,
                );
                setSetting(next, key, getSetting(previousSettings, key) ?? defaultValue);
                continue;
            }

            setSetting(next, key, parsedValue);
        }
    }

    return next;
}

export function getDefaultConfigurationRows(): Array<{
    settingKey: DynamicSettingKey;
    value: string;
    description: string;
}> {
    return Object.entries(DYNAMIC_SETTINGS_DEFAULTS).flatMap(([section, sectionDefaults]) =>
        Object.entries(sectionDefaults).map(([setting, value]) => {
            const settingKey = `${section}.${setting}` as DynamicSettingKey;
            return {
                settingKey,
                value: String(value),
                description: DYNAMIC_SETTING_DESCRIPTIONS[settingKey],
            };
        }),
    );
}
