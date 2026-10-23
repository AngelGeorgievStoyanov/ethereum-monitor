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
    }
) {
    const [updatedCount] = await Configuration.update(updates, { where: { id } });
    if (updatedCount === 0) return null;
    return Configuration.findByPk(id);
}

export function deleteConfigurationById(id: string) {
    return Configuration.destroy({ where: { id } });
}
