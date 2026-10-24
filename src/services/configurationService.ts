import { findActiveConfigurations } from '../repositories/configurationRepository';
import Configuration from '../models/configuration';

export function createConfigurationService() {
    const configurations = new Map<string, Configuration>();

    async function loadConfigurations() {
        const configs = await findActiveConfigurations();
        configurations.clear();
        configs.forEach((config) => configurations.set(config.id, config));
        console.log(`[Scanner] Loaded ${configurations.size} active configuration(s)`);
    }

    function syncConfiguration(config: Configuration) {
        if (config.isActive) configurations.set(config.id, config);
        else configurations.delete(config.id);
    }

    async function removeConfiguration(id: string) {
        configurations.delete(id);
    }

    return {
        loadConfigurations,
        addConfiguration: syncConfiguration,
        updateConfiguration: syncConfiguration,
        removeConfiguration,
        getConfigurations: () => Array.from(configurations.values()),
    };
}

let configurationServiceInstance: ReturnType<typeof createConfigurationService> | undefined;

export function getConfigurationService() {
    if (!configurationServiceInstance) {
        configurationServiceInstance = createConfigurationService();
    }
    return configurationServiceInstance;
}
