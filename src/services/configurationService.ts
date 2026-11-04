import {
    DYNAMIC_SETTINGS_DEFAULTS,
    type DynamicSettings,
} from '../constants/dynamic-settings.constants';
import Configuration from '../models/configuration';
import {
    mapConfigurationRowsToDynamicSettings,
    type ConfigurationRow,
} from '../mappers/configurationMapper';
import { formatError } from '../utils/formatError';

export function createConfigurationService() {
    let dynamicSettings: DynamicSettings = {
        scanner: { ...DYNAMIC_SETTINGS_DEFAULTS.scanner },
        metrics: { ...DYNAMIC_SETTINGS_DEFAULTS.metrics },
    };

    async function refresh(): Promise<void> {
        try {
            const configurations = await Configuration.findAll({
                attributes: ['settingKey', 'value'],
            });
            const rows: ConfigurationRow[] = configurations.map(({ settingKey, value }) => ({
                settingKey,
                value,
            }));

            dynamicSettings = mapConfigurationRowsToDynamicSettings(rows, dynamicSettings);
            console.log(
                `[Configuration] Loaded dynamic settings; rows=${rows.length}`,
            );
        } catch (error) {
            console.error(
                `[Configuration] Refresh failed; keeping last valid settings: ${formatError(error)}`,
            );
        }
    }

    function getDynamicSettings(): DynamicSettings {
        return {
            scanner: { ...dynamicSettings.scanner },
            metrics: { ...dynamicSettings.metrics },
        };
    }

    return {
        refresh,
        getDynamicSettings,
    };
}

let configurationServiceInstance: ReturnType<typeof createConfigurationService> | undefined;

export function getConfigurationService() {
    if (!configurationServiceInstance) {
        configurationServiceInstance = createConfigurationService();
    }
    return configurationServiceInstance;
}
