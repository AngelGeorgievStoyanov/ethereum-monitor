import sequelize from '../database';
import Block from '../models/block';
import ScannerState from '../models/scannerState';
import TxFilter from '../models/txFilter';
import { env } from '../config/env';
import { SCANNER_ID } from '../constants/scanner.constants';
import { FILTER_MUTATION_ADVISORY_LOCK_KEY, TX_FILTER_RELOAD_RETRY_DELAYS_MS } from '../constants/tx-filter.constants';
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
import { ActiveTxFilter, TxFilterGroupRule } from './txFilterEvaluatorService';
import { validateTxFilterGroup } from './txFilterValidationService';
import { ValidationError } from '../utils/validationError';
import { sleep } from '../utils/sleep';
import { formatError } from '../utils/formatError';
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
    let txFilters = new Map<number, ActiveTxFilter>();
    let reloadQueue: Promise<void> = Promise.resolve();
    let pendingReloadCount = 0;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;

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
                description: filter.description,
                isActive: filter.isActive,
                activeFromBlock: filter.activeFromBlock,
                rule,
            });
        }
        // Keep the last valid cache untouched until the full collection has loaded successfully.
        const currentSignature = JSON.stringify(
            Array.from(txFilters.entries()).sort(([leftId], [rightId]) => leftId - rightId),
        );
        const nextSignature = JSON.stringify(
            Array.from(next.entries()).sort(([leftId], [rightId]) => leftId - rightId),
        );
        if (currentSignature === nextSignature) {
            console.log(`[Scanner] Transaction filter cache unchanged (${txFilters.size} active filter(s))`);
            return;
        }

        txFilters = next;
        console.log(`[Scanner] Loaded ${txFilters.size} active tx filter(s)`);
    }

    async function reloadTxFiltersWithRetry(): Promise<boolean> {
        pendingReloadCount += 1;
        const task = reloadQueue
            .catch(() => undefined)
            .then(async () => {
                for (let attempt = 0; attempt <= TX_FILTER_RELOAD_RETRY_DELAYS_MS.length; attempt += 1) {
                    try {
                        await loadTxFilters();
                        return true;
                    } catch (error) {
                        if (attempt === TX_FILTER_RELOAD_RETRY_DELAYS_MS.length) {
                            console.error(
                                `[Scanner] Failed to reload tx filters after ${attempt + 1} attempt(s): ${formatError(error)}`,
                            );
                            return false;
                        }
                        console.error(
                            `[Scanner] Failed to reload tx filters (attempt ${attempt + 1}/${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1}); retrying: ${formatError(error)}`,
                        );
                        await sleep(TX_FILTER_RELOAD_RETRY_DELAYS_MS[attempt]);
                    }
                }
                return false;
            });
        const settledTask = task.finally(() => {
            pendingReloadCount -= 1;
        });
        reloadQueue = settledTask.then(
            () => undefined,
            () => undefined,
        );
        return settledTask;
    }

    function startRefreshTimer(intervalMs: number) {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
            // Do not queue periodic refreshes while a refresh is queued or running.
            // Explicit refreshes after filter mutations still use the serialized queue.
            if (pendingReloadCount > 0) return;
            void reloadTxFiltersWithRetry();
        }, intervalMs);
        refreshTimer.unref?.();
        console.log(`[Scanner] Transaction filter cache refresh scheduled every ${intervalMs}ms`);
    }

    function stopRefreshTimer() {
        if (!refreshTimer) return;
        clearInterval(refreshTimer);
        refreshTimer = undefined;
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
                ? (initialStartBlock ?? await getNextFilterStartBlock())
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
        if (!(await reloadTxFiltersWithRetry())) throw new TxFilterSyncError(result);
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
        if (deleted > 0 && !(await reloadTxFiltersWithRetry())) {
            throw new TxFilterSyncError({ message: 'Transaction filter deleted', deleted: true });
        }
        return deleted;
    }

    return {
        loadTxFilters,
        startRefreshTimer,
        stopRefreshTimer,
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
