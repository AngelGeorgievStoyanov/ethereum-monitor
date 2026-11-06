import type { DynamicSettings } from '../constants/dynamic-settings.constants';
import Configuration from '../models/configuration';
import {
    mapConfigurationRowsToDynamicSettings,
    type ConfigurationRow,
} from '../mappers/configurationMapper';
import { formatError } from '../utils/formatError';

export function createConfigurationService() {
    let dynamicSettings: DynamicSettings = {};

    async function refresh(): Promise<void> {
        try {
            const configurations = await Configuration.findAll({
                attributes: ['settingKey', 'value'],
            });
            const rows: ConfigurationRow[] = configurations.map(({ settingKey, value }) => ({
                settingKey,
                value,
            }));

            dynamicSettings = mapConfigurationRowsToDynamicSettings(rows);
            console.log(`[Configuration] Loaded dynamic settings; rows=${rows.length}`);
        } catch (error) {
            console.error(
                `[Configuration] Refresh failed; keeping last valid settings: ${formatError(error)}`,
            );
        }
    }

    function getDynamicSettings(): DynamicSettings {
        return { ...dynamicSettings };
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
