import { Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../database';
import TxFilter from '../models/txFilter';
import TxMatch from '../models/txMatch';

export function findAllTxFilters() {
    return TxFilter.findAll({ order: [['id', 'ASC']] });
}

export function findActiveTxFilters() {
    return TxFilter.findAll({ where: { isActive: true }, order: [['id', 'ASC']] });
}

export function findTxFilterById(id: number) {
    return TxFilter.findByPk(id);
}

export function createTxFilter(
    data: {
        description: string;
        from: string | null;
        to: string | null;
        isActive: boolean;
        activeFromBlock: number | null;
    },
    transaction?: SequelizeTransaction,
) {
    return TxFilter.create(data, transaction ? { transaction } : undefined);
}

export async function updateTxFilter(
    id: number,
    updates: {
        description?: string;
        from?: string | null;
        to?: string | null;
        isActive?: boolean;
        activeFromBlock?: number | null;
    },
    transaction?: SequelizeTransaction,
) {
    const txFilter = await TxFilter.findByPk(id, transaction ? { transaction } : undefined);
    if (!txFilter) return null;

    if (updates.description !== undefined) txFilter.description = updates.description;
    if (updates.from !== undefined) txFilter.from = updates.from;
    if (updates.to !== undefined) txFilter.to = updates.to;
    if (updates.isActive !== undefined) txFilter.isActive = updates.isActive;
    if (updates.activeFromBlock !== undefined) txFilter.activeFromBlock = updates.activeFromBlock;

    await txFilter.save(transaction ? { transaction } : undefined);
    return txFilter;
}

export async function deleteTxFilterById(id: number, transaction?: SequelizeTransaction) {
    const remove = async (activeTransaction: SequelizeTransaction) => {
        const txFilter = await TxFilter.findByPk(id, { transaction: activeTransaction });
        if (!txFilter) return 0;

        // Keep historical matches and snapshot the description before unlinking the filter.
        await TxMatch.update(
            { txFilterDescription: txFilter.description },
            {
                where: { txFilterId: id, txFilterDescription: null },
                transaction: activeTransaction,
            },
        );
        await TxMatch.update(
            { txFilterId: null },
            { where: { txFilterId: id }, transaction: activeTransaction },
        );

        // Database foreign keys cascade-delete groups, nested groups, and conditions.
        return TxFilter.destroy({ where: { id }, transaction: activeTransaction });
    };

    if (transaction) return remove(transaction);
    return sequelize.transaction(remove);
}
