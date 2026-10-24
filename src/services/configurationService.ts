import Configuration from '../models/configuration';
import {
    createConfiguration as insertConfiguration,
    deleteConfigurationById,
    findActiveConfigurations,
    findAllConfigurations,
    updateConfiguration as persistConfiguration,
} from '../repositories/configurationRepository';

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

    async function getAllConfigurations() {
        return findAllConfigurations();
    }

    async function createConfiguration(data: {
        name: string;
        senderAddress: string | null;
        recipientAddress: string | null;
        isActive: boolean;
    }) {
        const configuration = await insertConfiguration(data);
        syncConfiguration(configuration);
        return configuration;
    }

    async function updateConfiguration(
        id: string,
        updates: {
            name?: string;
            senderAddress?: string | null;
            recipientAddress?: string | null;
            isActive?: boolean;
        },
    ) {
        const configuration = await persistConfiguration(id, updates);
        if (configuration) syncConfiguration(configuration);
        return configuration;
    }

    async function removeConfiguration(id: string) {
        const deleted = await deleteConfigurationById(id);
        if (deleted > 0) configurations.delete(id);
        return deleted;
    }

    return {
        loadConfigurations,
        getAllConfigurations,
        createConfiguration,
        updateConfiguration,
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
