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
import { getNextFilterStartBlock } from './txFilterActivationService';
import { mapTxFilterListResponse, mapTxFilterResponse } from '../mappers/txFilterMapper';
import {
    mapTxFilterSyncFailureResponse,
    type TxFilterMutationOperation,
} from '../mappers/txFilterResponseMapper';
import type { ActiveTxFilter, TxFilterRule } from '../types/tx-filter.types';
import { validateTxFilterRule } from './txFilterValidationService';
import { compileTxFilterRule } from './txFilterCompilerService';
import { ValidationError } from '../utils/validationError';

export class TxFilterSyncError extends Error {
    public readonly response: ReturnType<typeof mapTxFilterSyncFailureResponse>;

    constructor(operation: TxFilterMutationOperation, result: unknown) {
        super('The filter change was saved to the database, but the scanner filters were not refreshed.');
        this.name = 'TxFilterSyncError';
        this.response = mapTxFilterSyncFailureResponse(operation, result);
    }
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
        if (!refreshDynamicConfig || !(await refreshDynamicConfig())) {
            throw new TxFilterSyncError(operation, result);
        }
    }

    async function loadActiveTxFilters(): Promise<ActiveTxFilter[]> {
        const activeFilters = await findActiveTxFilters();
        const next: ActiveTxFilter[] = [];
        let missingFiltersStartBlock: number | undefined;

        for (const filter of activeFilters) {
            validateTxFilterRule(filter.rule);
            if (filter.activeFromBlock === null || filter.activeFromBlock === undefined) {
                if (missingFiltersStartBlock === undefined) {
                    missingFiltersStartBlock = await getNextFilterStartBlock();
                }
                await assignActiveFilterStartBlock(filter.id, missingFiltersStartBlock);
                filter.activeFromBlock = missingFiltersStartBlock;
            }
            next.push({
                id: filter.id,
                description: filter.description,
                isActive: filter.isActive,
                activeFromBlock: filter.activeFromBlock,
                rule: filter.rule,
                predicate: compileTxFilterRule(filter.rule),
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
        return mapTxFilterListResponse(filters);
    }

    async function createTxFilter(data: {
        description: string;
        isActive: boolean;
        rule: TxFilterRule;
    }) {
        validateTxFilterRule(data.rule);

        const filter = await withTxFilterMutationLock(async (transaction) => {
            const initialStartBlock = data.isActive
                ? await findInitialConfiguredStartBlock(env.startBlock, SCANNER_ID, transaction)
                : undefined;
            const activeFromBlock = data.isActive
                ? (initialStartBlock ?? (await getNextFilterStartBlock()))
                : null;

            return insertTxFilter(
                {
                    description: data.description,
                    isActive: data.isActive,
                    activeFromBlock,
                    rule: data.rule,
                },
                transaction,
            );
        });

        const result = mapTxFilterResponse(filter);
        await refreshAfterMutation(result, 'created');
        return result;
    }

    async function updateTxFilter(
        id: number,
        updates: {
            description?: string;
            isActive?: boolean;
            rule?: TxFilterRule;
        },
    ) {
        if (updates.rule !== undefined) validateTxFilterRule(updates.rule);

        const updated = await withTxFilterMutationLock(async (transaction) => {
            const current = await findTxFilterForUpdate(id, transaction);
            if (!current) return null;

            const activatingOrChangingRule =
                updates.isActive === true || updates.rule !== undefined;
            const activeFromBlock =
                updates.isActive === false
                    ? null
                    : activatingOrChangingRule && (updates.isActive ?? current.isActive)
                      ? await getNextFilterStartBlock()
                      : current.activeFromBlock;

            return persistTxFilter(
                id,
                {
                    ...(updates.description !== undefined
                        ? { description: updates.description }
                        : {}),
                    ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
                    ...(updates.rule !== undefined ? { rule: updates.rule } : {}),
                    ...(activeFromBlock !== undefined ? { activeFromBlock } : {}),
                },
                transaction,
            );
        });

        if (!updated) return null;
        const result = mapTxFilterResponse(updated);
        await refreshAfterMutation(result, 'updated');
        return result;
    }

    async function removeTxFilter(id: number) {
        const deleted = await withTxFilterMutationLock(async (transaction) =>
            deleteTxFilterById(id, transaction),
        );
        if (deleted > 0) {
            await refreshAfterMutation(
                { message: 'Transaction filter deleted', deleted: true },
                'deleted',
            );
        }
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
