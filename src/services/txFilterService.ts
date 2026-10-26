import sequelize from '../database';
import TxFilter from '../models/txFilter';
import {
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    findTxFilterById,
    updateTxFilter as persistTxFilter,
} from '../repositories/txFilterRepository';
import {
    findRuleForFilter,
    findRulesForFilters,
    saveRuleForFilter,
} from '../repositories/txFilterRuleRepository';
import { getNextFilterStartBlock } from './txFilterActivationService';
import { ActiveTxFilter, TxFilterGroupRule } from './txFilterEvaluatorService';
import { validateTxFilterGroup } from './txFilterValidationService';
import { ValidationError } from '../utils/validationError';
import { sleep } from '../utils/sleep';
import { formatError } from '../utils/formatError';

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
    let txFilters = new Map<number, ActiveTxFilter>();
    let reloadQueue: Promise<void> = Promise.resolve();

    async function loadTxFilters() {
        const activeFilters = await findActiveTxFilters();
        const rulesByFilterId = await findRulesForFilters(activeFilters.map((filter) => filter.id));
        const next = new Map<number, ActiveTxFilter>();
        let missingFiltersStartBlock: number | undefined;
        for (const filter of activeFilters) {
            const rule = rulesByFilterId.get(filter.id) ?? legacyRule(filter);
            if (!rule) continue;
            if (filter.activeFromBlock === null || filter.activeFromBlock === undefined) {
                if (missingFiltersStartBlock === undefined) {
                    missingFiltersStartBlock = await getNextFilterStartBlock();
                }
                filter.activeFromBlock = missingFiltersStartBlock;
                await filter.save();
            }
            next.set(filter.id, {
                id: filter.id,
                isActive: filter.isActive,
                activeFromBlock: filter.activeFromBlock,
                rule,
            });
        }
        // Publish only after the full collection has loaded successfully.
        txFilters = next;
        console.log(`[Scanner] Loaded ${txFilters.size} active tx filter(s)`);
    }

    async function reloadTxFiltersWithRetry(): Promise<boolean> {
        const task = reloadQueue
            .catch(() => undefined)
            .then(async () => {
                const retryDelaysMs = [1000, 2000, 5000];
                for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
                    try {
                        await loadTxFilters();
                        return true;
                    } catch (error) {
                        if (attempt === retryDelaysMs.length) {
                            console.error(
                                `[Scanner] Failed to reload tx filters after ${attempt + 1} attempt(s): ${formatError(error)}`,
                            );
                            return false;
                        }
                        console.error(
                            `[Scanner] Failed to reload tx filters (attempt ${attempt + 1}/${retryDelaysMs.length + 1}); retrying: ${formatError(error)}`,
                        );
                        await sleep(retryDelaysMs[attempt]);
                    }
                }
                return false;
            });
        reloadQueue = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }

    async function getAllTxFilters() {
        const filters = await findAllTxFilters();
        const rulesByFilterId = await findRulesForFilters(filters.map((filter) => filter.id));
        return filters.map((filter) => ({
            ...filter.toJSON(),
            rule: rulesByFilterId.get(filter.id) ?? legacyRule(filter),
        }));
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
        const activeFromBlock = data.isActive ? await getNextFilterStartBlock() : null;
        const filter = await sequelize.transaction(async (transaction) => {
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
        if (!(await reloadTxFiltersWithRetry())) throw new TxFilterSyncError(result);
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
        const current = await findTxFilterById(id);
        if (!current) return null;
        const existingRule = updates.rule === undefined ? await findRuleForFilter(id) : null;
        if (updates.rule === null && !current.from && !current.to && !updates.from && !updates.to) {
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

        const filter = await sequelize.transaction(async (transaction) => {
            const updatedFilter = await persistTxFilter(
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
            if (updates.rule !== undefined) {
                await saveRuleForFilter(id, updates.rule, transaction);
            }
            return updatedFilter;
        });

        if (!filter) return null;
        const rule =
            updates.rule !== undefined
                ? (updates.rule ?? legacyRule(filter))
                : (existingRule ?? legacyRule(filter));
        const result = { ...filter.toJSON(), rule };
        if (!(await reloadTxFiltersWithRetry())) throw new TxFilterSyncError(result);
        return result;
    }

    async function removeTxFilter(id: number) {
        const deleted = await sequelize.transaction(async (transaction) =>
            deleteTxFilterById(id, transaction),
        );
        if (deleted > 0 && !(await reloadTxFiltersWithRetry())) {
            throw new TxFilterSyncError({ message: 'Transaction filter deleted', deleted: true });
        }
        return deleted;
    }

    return {
        loadTxFilters,
        getAllTxFilters,
        createTxFilter,
        updateTxFilter,
        removeTxFilter,
        getTxFilters: () => Array.from(txFilters.values()),
    };
}

let txFilterServiceInstance: ReturnType<typeof createTxFilterService> | undefined;

export function getTxFilterService() {
    if (!txFilterServiceInstance) txFilterServiceInstance = createTxFilterService();
    return txFilterServiceInstance;
}
