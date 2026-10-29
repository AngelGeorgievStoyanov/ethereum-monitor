import sequelize from '../database';
import Block from '../models/block';
import ScannerState from '../models/scannerState';
import TxFilter from '../models/txFilter';
import { env } from '../config/env';
import { SCANNER_ID } from '../constants/scanner.constants';
import { FILTER_MUTATION_ADVISORY_LOCK_KEY } from '../constants/tx-filter.constants';
import {
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
} from '../repositories/txFilterRepository';
import {
    findRuleForFilter,
    findRulesForFilters,
    saveRuleForFilter,
} from '../repositories/txFilterRuleRepository';
import { getNextFilterStartBlock } from './txFilterActivationService';
import type { ActiveTxFilter, TxFilterGroupRule } from '../types/tx-filter.types';
import { validateTxFilterGroup } from './txFilterValidationService';
import { ValidationError } from '../utils/validationError';
import { Transaction as SequelizeTransaction } from 'sequelize';

export class TxFilterSyncError extends Error {
    constructor(public readonly result: unknown) {
        super(
            'The filter change was saved to the database, but the scanner filters were not refreshed.',
        );
        this.name = 'TxFilterSyncError';
    }
}

function legacyRule(txFilter: TxFilter): TxFilterGroupRule | null {
    const conditions = [];
    if (txFilter.from) conditions.push({ field: 'from', operator: 'eq', value: txFilter.from });
    if (txFilter.to) conditions.push({ field: 'to', operator: 'eq', value: txFilter.to });
    return conditions.length ? { logic: 'AND', conditions, groups: [] } : null;
}

export function createTxFilterService() {
    let refreshDynamicConfig: (() => Promise<boolean>) | undefined;
    function setDynamicConfigRefreshHandler(handler: () => Promise<boolean>): void { refreshDynamicConfig = handler; }
    async function refreshAfterMutation(result: unknown): Promise<void> {
        if (!refreshDynamicConfig || !(await refreshDynamicConfig())) throw new TxFilterSyncError(result);
    }
    async function loadActiveTxFilters(): Promise<ActiveTxFilter[]> {
        const activeFilters = await findActiveTxFilters();
        const rulesByFilterId = await findRulesForFilters(activeFilters.map((filter) => filter.id));
        const next: ActiveTxFilter[] = [];
        let missingFiltersStartBlock: number | undefined;
        for (const filter of activeFilters) {
            const rule = rulesByFilterId.get(filter.id) ?? legacyRule(filter);
            if (!rule) continue;
            if (filter.activeFromBlock === null || filter.activeFromBlock === undefined) {
                if (missingFiltersStartBlock === undefined) missingFiltersStartBlock = await getNextFilterStartBlock();
                filter.activeFromBlock = missingFiltersStartBlock;
                await filter.save();
            }
            next.push({ id: filter.id, description: filter.description, isActive: filter.isActive, activeFromBlock: filter.activeFromBlock, rule });
        }
        return next;
    }

    async function getAllTxFilters() {
        const filters = await findAllTxFilters();
        const rulesByFilterId = await findRulesForFilters(filters.map((filter) => filter.id));
        return filters.map((filter) => ({
            ...filter.toJSON(),
            rule: rulesByFilterId.get(filter.id) ?? legacyRule(filter),
        }));
    }

    async function getInitialConfiguredStartBlock(
        transaction: SequelizeTransaction,
    ): Promise<number | undefined> {
        if (env.startBlock === undefined) return undefined;

        const existingActiveFilter = await TxFilter.findOne({
            where: { isActive: true },
            transaction,
        });
        if (existingActiveFilter) return undefined;

        const state = await ScannerState.findByPk(SCANNER_ID, { transaction });
        if (state && state.lastProcessedBlock !== env.startBlock - 1) return undefined;

        const existingCanonicalBlock = await Block.findOne({
            where: { status: 'CANONICAL' },
            attributes: ['id'],
            transaction,
        });
        if (existingCanonicalBlock) return undefined;

        return env.startBlock;
    }

    async function createTxFilter(data: {
        description: string;
        from?: string | null;
        to?: string | null;
        isActive: boolean;
        rule?: TxFilterGroupRule;
    }) {
        if (!data.rule && !data.from && !data.to) {
            throw new ValidationError('A filter requires at least one condition');
        }
        if (data.rule) validateTxFilterGroup(data.rule);

        const filter = await sequelize.transaction(async (transaction) => {
            // Serialize filter creation so concurrent requests cannot both claim the initial backfill range.
            await sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
                replacements: { key: FILTER_MUTATION_ADVISORY_LOCK_KEY },
                transaction,
            });
            const initialStartBlock = data.isActive
                ? await getInitialConfiguredStartBlock(transaction)
                : undefined;
            const activeFromBlock = data.isActive
                ? (initialStartBlock ?? (await getNextFilterStartBlock()))
                : null;
            const createdFilter = await insertTxFilter(
                {
                    description: data.description,
                    from: data.from ?? null,
                    to: data.to ?? null,
                    isActive: data.isActive,
                    activeFromBlock,
                },
                transaction,
            );
            if (data.rule) await saveRuleForFilter(createdFilter.id, data.rule, transaction);
            return createdFilter;
        });

        const result = { ...filter.toJSON(), rule: data.rule ?? legacyRule(filter) };
        await refreshAfterMutation(result);
        return result;
    }

    async function updateTxFilter(
        id: number,
        updates: {
            description?: string;
            from?: string | null;
            to?: string | null;
            isActive?: boolean;
            rule?: TxFilterGroupRule | null;
        },
    ) {
        if (updates.rule) validateTxFilterGroup(updates.rule);

        const updated = await sequelize.transaction(async (transaction) => {
            await sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
                replacements: { key: FILTER_MUTATION_ADVISORY_LOCK_KEY },
                transaction,
            });

            const current = await TxFilter.findByPk(id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!current) return null;

            const existingRule = updates.rule === undefined ? await findRuleForFilter(id) : null;
            if (
                updates.rule === null &&
                !current.from &&
                !current.to &&
                !updates.from &&
                !updates.to
            ) {
                throw new ValidationError('A filter requires at least one condition');
            }

            const activatingOrChangingRule =
                updates.isActive === true ||
                updates.rule !== undefined ||
                updates.from !== undefined ||
                updates.to !== undefined;
            const activeFromBlock =
                updates.isActive === false
                    ? null
                    : activatingOrChangingRule && (updates.isActive ?? current.isActive)
                      ? await getNextFilterStartBlock()
                      : current.activeFromBlock;

            const filter = await persistTxFilter(
                id,
                {
                    ...(updates.description !== undefined
                        ? { description: updates.description }
                        : {}),
                    ...(updates.from !== undefined ? { from: updates.from } : {}),
                    ...(updates.to !== undefined ? { to: updates.to } : {}),
                    ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
                    ...(activeFromBlock !== undefined ? { activeFromBlock } : {}),
                },
                transaction,
            );
            if (!filter) return null;
            if (updates.rule !== undefined) {
                await saveRuleForFilter(id, updates.rule, transaction);
            }
            const rule =
                updates.rule !== undefined
                    ? (updates.rule ?? legacyRule(filter))
                    : (existingRule ?? legacyRule(filter));
            return { filter, rule };
        });

        if (!updated) return null;
        const result = { ...updated.filter.toJSON(), rule: updated.rule };
        await refreshAfterMutation(result);
        return result;
    }

    async function removeTxFilter(id: number) {
        const deleted = await sequelize.transaction(async (transaction) => {
            await sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
                replacements: { key: FILTER_MUTATION_ADVISORY_LOCK_KEY },
                transaction,
            });
            return deleteTxFilterById(id, transaction);
        });
        if (deleted > 0) await refreshAfterMutation({ message: 'Transaction filter deleted', deleted: true });
        return deleted;
    }

    return { loadActiveTxFilters, setDynamicConfigRefreshHandler, getAllTxFilters, createTxFilter, updateTxFilter, removeTxFilter };
}

let txFilterServiceInstance: ReturnType<typeof createTxFilterService> | undefined;

export function getTxFilterService() {
    if (!txFilterServiceInstance) txFilterServiceInstance = createTxFilterService();
    return txFilterServiceInstance;
}
