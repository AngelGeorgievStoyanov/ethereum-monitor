import type { DynamicSettings } from '../constants/dynamic-settings.constants';

export interface ConfigurationRow {
    settingKey: string;
    value: string;
}

export function mapConfigurationRowsToDynamicSettings(rows: ConfigurationRow[]): DynamicSettings {
    return rows.reduce<DynamicSettings>((settings, row) => {
        settings[row.settingKey] = row.value;
        return settings;
    }, {});
}
