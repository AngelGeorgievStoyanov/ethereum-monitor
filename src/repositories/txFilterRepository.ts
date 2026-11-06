import { Transaction as SequelizeTransaction } from 'sequelize';
import { FILTER_MUTATION_ADVISORY_LOCK_KEY } from '../constants/tx-filter.constants';
import sequelize from '../database';
import TxFilter from '../models/txFilter';
import TxMatch from '../models/txMatch';
import type { TxFilterRecord, TxFilterRule } from '../types/tx-filter.types';
import { createTxFilterRuleSignature } from '../utils/txFilterRuleSignature';

function toTxFilterRecord(filter: TxFilter): TxFilterRecord {
    return {
        id: filter.id,
        description: filter.description,
        isActive: filter.isActive,
        rule: filter.rule,
    };
}

export async function findAllTxFilters(): Promise<TxFilterRecord[]> {
    const filters = await TxFilter.findAll({ order: [['id', 'ASC']] });
    return filters.map(toTxFilterRecord);
}

export async function findActiveTxFilters(): Promise<TxFilterRecord[]> {
    const filters = await TxFilter.findAll({
        where: { isActive: true },
        order: [['id', 'ASC']],
    });
    return filters.map(toTxFilterRecord);
}

export async function countActiveTxFilters(transaction: SequelizeTransaction): Promise<number> {
    return TxFilter.count({ where: { isActive: true }, transaction });
}

export async function createTxFilter(
    data: {
        description: string;
        isActive: boolean;
        rule: TxFilterRule;
    },
    transaction?: SequelizeTransaction,
): Promise<TxFilterRecord> {
    const filter = await TxFilter.create(data, transaction ? { transaction } : undefined);
    return toTxFilterRecord(filter);
}

export async function updateTxFilter(
    filter: TxFilter,
    updates: {
        description?: string;
        isActive?: boolean;
        rule?: TxFilterRule;
    },
    transaction: SequelizeTransaction,
): Promise<TxFilterRecord> {
    if (updates.description !== undefined) filter.description = updates.description;
    if (updates.isActive !== undefined) filter.isActive = updates.isActive;
    if (updates.rule !== undefined) filter.rule = updates.rule;

    await filter.save(transaction ? { transaction } : undefined);
    return toTxFilterRecord(filter);
}

export async function deleteTxFilterById(id: number, transaction?: SequelizeTransaction) {
    const remove = async (activeTransaction: SequelizeTransaction) => {
        const filter = await TxFilter.findByPk(id, { transaction: activeTransaction });
        if (!filter) return 0;

        await TxMatch.update(
            { txFilterDescription: filter.description },
            {
                where: { txFilterId: id, txFilterDescription: null },
                transaction: activeTransaction,
            },
        );
        await TxMatch.update(
            { matchStatus: 'FILTER_DELETED' },
            { where: { txFilterId: id }, transaction: activeTransaction },
        );
        return TxFilter.destroy({ where: { id }, transaction: activeTransaction });
    };

    if (transaction) return remove(transaction);
    return sequelize.transaction(remove);
}

export async function deactivateInvalidTxFilter(
    id: number,
    expectedRuleSignature: string,
): Promise<boolean> {
    return withTxFilterMutationLock(async (transaction) => {
        const filter = await TxFilter.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (
            !filter ||
            !filter.isActive ||
            createTxFilterRuleSignature(filter.rule) !== expectedRuleSignature
        ) {
            return false;
        }

        filter.isActive = false;
        await filter.save({ transaction });
        return true;
    });
}

export async function findTxFilterForUpdate(
    id: number,
    transaction: SequelizeTransaction,
): Promise<TxFilter | null> {
    return TxFilter.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
}

export async function withTxFilterMutationLock<T>(
    operation: (transaction: SequelizeTransaction) => Promise<T>,
): Promise<T> {
    return sequelize.transaction(async (transaction) => {
        await sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
            replacements: { key: FILTER_MUTATION_ADVISORY_LOCK_KEY },
            transaction,
        });
        return operation(transaction);
    });
}
