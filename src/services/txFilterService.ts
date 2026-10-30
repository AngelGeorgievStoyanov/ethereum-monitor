import {
    countActiveTxFilters,
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
    findTxFilterForUpdate,
    withTxFilterMutationLock,
} from '../repositories/txFilterRepository';
import { MAX_ACTIVE_TX_FILTERS } from '../constants/tx-filter.constants';
import { mapTxFilterListResponse, mapTxFilterResponse } from '../mappers/txFilterMapper';
import {
    mapTxFilterSyncFailureResponse,
    type TxFilterMutationOperation,
} from '../mappers/txFilterResponseMapper';
import type { ActiveTxFilter, TxFilterRule } from '../types/tx-filter.types';
import { compileTxFilterRule } from './txFilterCompilerService';
import { validateTxFilterAddresses } from './txFilterAddressValidationService';
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
    let compiledConfigSignature = '';

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
        const signature = JSON.stringify(activeFilters);
        if (signature === compiledConfigSignature) return activeTxFiltersCache;

        const next: ActiveTxFilter[] = activeFilters.map((filter) => ({
            id: filter.id,
            description: filter.description,
            rule: filter.rule,
            predicate: compileTxFilterRule(filter.rule),
        }));

        activeTxFiltersCache = next;
        compiledConfigSignature = signature;
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
        validateTxFilterAddresses(data.rule);

        const filter = await withTxFilterMutationLock(async (transaction) => {
            if (
                data.isActive &&
                (await countActiveTxFilters(transaction)) >= MAX_ACTIVE_TX_FILTERS
            ) {
                throw new ValidationError(
                    `A maximum of ${MAX_ACTIVE_TX_FILTERS} active transaction filters is allowed`,
                );
            }

            return insertTxFilter(
                {
                    description: data.description,
                    isActive: data.isActive,
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
        if (updates.rule) validateTxFilterAddresses(updates.rule);

        const updated = await withTxFilterMutationLock(async (transaction) => {
            const current = await findTxFilterForUpdate(id, transaction);
            if (!current) return null;

            if (
                updates.isActive === true &&
                !current.isActive &&
                (await countActiveTxFilters(transaction)) >= MAX_ACTIVE_TX_FILTERS
            ) {
                throw new ValidationError(
                    `A maximum of ${MAX_ACTIVE_TX_FILTERS} active transaction filters is allowed`,
                );
            }

            return persistTxFilter(id, updates, transaction);
        });

        if (!updated) return null;
        const result = mapTxFilterResponse(updated);
        await refreshAfterMutation(result, 'updated');
        return result;
    }

    async function removeTxFilter(id: number) {
        const deleted = await withTxFilterMutationLock((transaction) =>
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
