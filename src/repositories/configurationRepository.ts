import Configuration from '../models/configuration';

export function findAllConfigurations() {
    return Configuration.findAll();
}

export function findActiveConfigurations() {
    return Configuration.findAll({ where: { isActive: true } });
}

export function findConfigurationById(id: string) {
    return Configuration.findByPk(id);
}

export function createConfiguration(data: {
    name: string;
    senderAddress: string | null;
    recipientAddress: string | null;
    isActive: boolean;
}) {
    return Configuration.create(data);
}

export async function updateConfiguration(
    id: string,
    updates: {
        name?: string;
        senderAddress?: string | null;
        recipientAddress?: string | null;
        isActive?: boolean;
    },
) {
    const configuration = await Configuration.findByPk(id);
    if (!configuration) return null;

    if (updates.name !== undefined) configuration.name = updates.name;
    if (updates.senderAddress !== undefined) configuration.senderAddress = updates.senderAddress;
    if (updates.recipientAddress !== undefined)
        configuration.recipientAddress = updates.recipientAddress;
    if (updates.isActive !== undefined) configuration.isActive = updates.isActive;

    await configuration.save();
    return configuration;
}

export function deleteConfigurationById(id: string) {
    return Configuration.destroy({ where: { id } });
}
