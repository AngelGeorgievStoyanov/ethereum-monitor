import TxFilter from '../models/txFilter';

export function findAllTxFilters() {
    return TxFilter.findAll();
}

export function findActiveTxFilters() {
    return TxFilter.findAll({ where: { isActive: true } });
}

export function findTxFilterById(id: string) {
    return TxFilter.findByPk(id);
}

export function createTxFilter(data: {
    name: string;
    senderAddress: string | null;
    recipientAddress: string | null;
    isActive: boolean;
}) {
    return TxFilter.create(data);
}

export async function updateTxFilter(
    id: string,
    updates: {
        name?: string;
        senderAddress?: string | null;
        recipientAddress?: string | null;
        isActive?: boolean;
    },
) {
    const txFilter = await TxFilter.findByPk(id);
    if (!txFilter) return null;

    if (updates.name !== undefined) txFilter.name = updates.name;
    if (updates.senderAddress !== undefined) txFilter.senderAddress = updates.senderAddress;
    if (updates.recipientAddress !== undefined)
        txFilter.recipientAddress = updates.recipientAddress;
    if (updates.isActive !== undefined) txFilter.isActive = updates.isActive;

    await txFilter.save();
    return txFilter;
}

export function deleteTxFilterById(id: string) {
    return TxFilter.destroy({ where: { id } });
}
