import TxFilter from '../models/txFilter';

export function findAllTxFilters() {
    return TxFilter.findAll();
}

export function findActiveTxFilters() {
    return TxFilter.findAll({ where: { isActive: true } });
}

export function findTxFilterById(id: number) {
    return TxFilter.findByPk(id);
}

export function createTxFilter(data: {
    description: string;
    from: string | null;
    to: string | null;
    isActive: boolean;
}) {
    return TxFilter.create(data);
}

export async function updateTxFilter(
    id: number,
    updates: {
        description?: string;
        from?: string | null;
        to?: string | null;
        isActive?: boolean;
    },
) {
    const txFilter = await TxFilter.findByPk(id);
    if (!txFilter) return null;

    if (updates.description !== undefined) txFilter.description = updates.description;
    if (updates.from !== undefined) txFilter.from = updates.from;
    if (updates.to !== undefined) txFilter.to = updates.to;
    if (updates.isActive !== undefined) txFilter.isActive = updates.isActive;

    await txFilter.save();
    return txFilter;
}

export function deleteTxFilterById(id: number) {
    return TxFilter.destroy({ where: { id } });
}
