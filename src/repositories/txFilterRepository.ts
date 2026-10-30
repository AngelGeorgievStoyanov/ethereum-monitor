import { Transaction as SequelizeTransaction } from 'sequelize';
import { FILTER_MUTATION_ADVISORY_LOCK_KEY } from '../constants/tx-filter.constants';
import sequelize from '../database';
import TxFilter from '../models/txFilter';
import TxMatch from '../models/txMatch';
import Block from '../models/block';
import ScannerState from '../models/scannerState';
import type { TxFilterRecord, TxFilterRule } from '../types/tx-filter.types';

function toTxFilterRecord(filter: TxFilter): TxFilterRecord {
    return {
        id: filter.id,
        description: filter.description,
        isActive: filter.isActive,
        activeFromBlock: filter.activeFromBlock,
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

export async function createTxFilter(
    data: {
        description: string;
        isActive: boolean;
        activeFromBlock: number | null;
        rule: TxFilterRule;
    },
    transaction?: SequelizeTransaction,
): Promise<TxFilterRecord> {
    const filter = await TxFilter.create(data, transaction ? { transaction } : undefined);
    return toTxFilterRecord(filter);
}

export async function updateTxFilter(
    id: number,
    updates: {
        description?: string;
        isActive?: boolean;
        activeFromBlock?: number | null;
        rule?: TxFilterRule;
    },
    transaction?: SequelizeTransaction,
): Promise<TxFilterRecord | null> {
    const filter = await TxFilter.findByPk(id, transaction ? { transaction } : undefined);
    if (!filter) return null;

    if (updates.description !== undefined) filter.description = updates.description;
    if (updates.isActive !== undefined) filter.isActive = updates.isActive;
    if (updates.activeFromBlock !== undefined) filter.activeFromBlock = updates.activeFromBlock;
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
        await TxMatch.update(
            { txFilterId: null },
            { where: { txFilterId: id }, transaction: activeTransaction },
        );

        return TxFilter.destroy({ where: { id }, transaction: activeTransaction });
    };

    if (transaction) return remove(transaction);
    return sequelize.transaction(remove);
}

export async function findTxFilterForUpdate(
    id: number,
    transaction: SequelizeTransaction,
): Promise<TxFilterRecord | null> {
    const filter = await TxFilter.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    return filter ? toTxFilterRecord(filter) : null;
}

export async function findInitialConfiguredStartBlock(
    startBlock: number | undefined,
    scannerId: string,
    transaction: SequelizeTransaction,
): Promise<number | undefined> {
    if (startBlock === undefined) return undefined;

    const existingActiveFilter = await TxFilter.findOne({
        where: { isActive: true },
        transaction,
    });
    if (existingActiveFilter) return undefined;

    const state = await ScannerState.findByPk(scannerId, { transaction });
    if (state && state.lastProcessedBlock !== startBlock - 1) return undefined;

    const existingCanonicalBlock = await Block.findOne({
        where: { status: 'CANONICAL' },
        attributes: ['id'],
        transaction,
    });
    if (existingCanonicalBlock) return undefined;

    return startBlock;
}

export async function assignActiveFilterStartBlock(
    id: number,
    activeFromBlock: number,
): Promise<void> {
    const filter = await updateTxFilter(id, { activeFromBlock });
    if (!filter) throw new Error(`Unable to set activation block for transaction filter ${id}`);
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
