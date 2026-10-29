import { env } from '../config/env';
import { SCANNER_ID } from '../constants/scanner.constants';
import {
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
    findTxFilterForUpdate,
    findInitialConfiguredStartBlock,
    assignActiveFilterStartBlock,
    withTxFilterMutationLock,
} from '../repositories/txFilterRepository';
import {
    findRuleForFilter,
    findRulesForFilters,
    saveRuleForFilter,
} from '../repositories/txFilterRuleRepository';
import { getNextFilterStartBlock } from './txFilterActivationService';
import { mapTxFilterListResponse, mapTxFilterResponse } from '../mappers/txFilterMapper';
import {
    mapTxFilterSyncFailureResponse,
    type TxFilterMutationOperation,
} from '../mappers/txFilterResponseMapper';
import type { ActiveTxFilter, TxFilterGroupRule } from '../types/tx-filter.types';
import { validateTxFilterGroup } from './txFilterValidationService';
import { ValidationError } from '../utils/validationError';

export class TxFilterSyncError extends Error {
    public readonly response: ReturnType<typeof mapTxFilterSyncFailureResponse>;

    constructor(operation: TxFilterMutationOperation, result: unknown) {
        super(
            'The filter change was saved to the database, but the scanner filters were not refreshed.',
        );
        this.name = 'TxFilterSyncError';
        this.response = mapTxFilterSyncFailureResponse(operation, result);
    }
}

interface LegacyTxFilterFields {
    from?: string | null;
    to?: string | null;
}

function legacyRule(txFilter: LegacyTxFilterFields): TxFilterGroupRule | null {
    const conditions = [];
    if (txFilter.from) conditions.push({ field: 'from', operator: 'eq', value: txFilter.from });
    if (txFilter.to) conditions.push({ field: 'to', operator: 'eq', value: txFilter.to });
    return conditions.length ? { logic: 'AND', conditions, groups: [] } : null;
}

export function createTxFilterService() {
    let refreshDynamicConfig: (() => Promise<boolean>) | undefined;
    let activeTxFiltersCache: ActiveTxFilter[] = [];
    function setDynamicConfigRefreshHandler(handler: () => Promise<boolean>): void {
        refreshDynamicConfig = handler;
    }
    async function refreshAfterMutation(
        result: unknown,
        operation: TxFilterMutationOperation,
    ): Promise<void> {
        if (!refreshDynamicConfig || !(await refreshDynamicConfig()))
            throw new TxFilterSyncError(operation, result);
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
                if (missingFiltersStartBlock === undefined)
                    missingFiltersStartBlock = await getNextFilterStartBlock();
                await assignActiveFilterStartBlock(filter.id, missingFiltersStartBlock);
                filter.activeFromBlock = missingFiltersStartBlock;
            }
            next.push({
                id: filter.id,
                description: filter.description,
                isActive: filter.isActive,
                activeFromBlock: filter.activeFromBlock,
                rule,
            });
        }
        activeTxFiltersCache = next;
        return next;
    }

    function getTxFilters(): ActiveTxFilter[] {
        return activeTxFiltersCache;
    }

    async function getAllTxFilters() {
        const filters = await findAllTxFilters();
        const rulesByFilterId = await findRulesForFilters(filters.map((filter) => filter.id));
        return mapTxFilterListResponse(
            filters,
            new Map(
                filters.map((filter) => [
                    filter.id,
                    rulesByFilterId.get(filter.id) ?? legacyRule(filter),
                ]),
            ),
        );
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

        const filter = await withTxFilterMutationLock(async (transaction) => {
            const initialStartBlock = data.isActive
                ? await findInitialConfiguredStartBlock(env.startBlock, SCANNER_ID, transaction)
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

        const result = mapTxFilterResponse(filter, data.rule ?? legacyRule(filter));
        await refreshAfterMutation(result, 'created');
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

        const updated = await withTxFilterMutationLock(async (transaction) => {
            const current = await findTxFilterForUpdate(id, transaction);
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
        const result = mapTxFilterResponse(updated.filter, updated.rule);
        await refreshAfterMutation(result, 'updated');
        return result;
    }

    async function removeTxFilter(id: number) {
        const deleted = await withTxFilterMutationLock(async (transaction) => {
            return deleteTxFilterById(id, transaction);
        });
        if (deleted > 0)
            await refreshAfterMutation(
                { message: 'Transaction filter deleted', deleted: true },
                'deleted',
            );
        return deleted;
    }

    return {
        loadActiveTxFilters,
        setDynamicConfigRefreshHandler,
        getTxFilters,
        getAllTxFilters,
        createTxFilter,
        updateTxFilter,
        removeTxFilter,
    };
}

let txFilterServiceInstance: ReturnType<typeof createTxFilterService> | undefined;

export function getTxFilterService() {
    if (!txFilterServiceInstance) txFilterServiceInstance = createTxFilterService();
    return txFilterServiceInstance;
}
