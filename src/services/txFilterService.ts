import { createHash } from 'node:crypto';
import {
    countActiveTxFilters,
    createTxFilter as insertTxFilter,
    deactivateInvalidTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
    findTxFilterForUpdate,
    withTxFilterMutationLock,
} from '../repositories/txFilterRepository';
import {
    MAX_ACTIVE_TX_FILTERS,
    TX_FILTER_INVALID_FILTER_MAX_ATTEMPTS,
    TX_FILTER_INVALID_FILTER_RETRY_INTERVAL_MS,
} from '../constants/tx-filter.constants';
import { mapTxFilterListResponse, mapTxFilterResponse } from '../mappers/txFilterMapper';
import {
    mapTxFilterSyncFailureResponse,
    type TxFilterMutationOperation,
} from '../mappers/txFilterResponseMapper';
import type { ActiveTxFilter, TxFilterRule } from '../types/tx-filter.types';
import { compileTxFilterRule } from './txFilterCompilerService';
import { validateTxFilterAddresses } from './txFilterAddressValidationService';
import { ValidationError } from '../utils/validationError';
import { formatError } from '../utils/formatError';

interface InvalidFilterRetryState {
    attempts: number;
    lastAttemptAt: number;
    ruleSignature: string;
}

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

export function createTxFilterService() {
    let refreshDynamicConfig: (() => Promise<boolean>) | undefined;
    let activeTxFiltersCache: ActiveTxFilter[] = [];
    const compiledFilters = new Map<
        number,
        { ruleSignature: string; predicate: ActiveTxFilter['predicate'] }
    >();
    const invalidFilterRetries = new Map<number, InvalidFilterRetryState>();

    function setDynamicConfigRefreshHandler(handler: () => Promise<boolean>): void {
        refreshDynamicConfig = handler;
    }

    function validateAndCompileRule(rule: TxFilterRule): ActiveTxFilter['predicate'] {
        validateTxFilterAddresses(rule);
        return compileTxFilterRule(rule);
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
        const activeIds = new Set(activeFilters.map((filter) => filter.id));

        for (const id of compiledFilters.keys()) {
            if (!activeIds.has(id)) compiledFilters.delete(id);
        }
        for (const id of invalidFilterRetries.keys()) {
            if (!activeIds.has(id)) invalidFilterRetries.delete(id);
        }

        const next: ActiveTxFilter[] = [];

        for (const filter of activeFilters) {
            const ruleSignature = createHash('sha256')
                .update(JSON.stringify(filter.rule))
                .digest('hex');
            const cached = compiledFilters.get(filter.id);

            if (cached?.ruleSignature === ruleSignature) {
                invalidFilterRetries.delete(filter.id);
                next.push({
                    id: filter.id,
                    description: filter.description,
                    ruleSignature,
                    predicate: cached.predicate,
                });
                continue;
            }

            const previousRetry = invalidFilterRetries.get(filter.id);
            const retryState =
                previousRetry?.ruleSignature === ruleSignature ? previousRetry : undefined;
            const now = Date.now();

            if (
                retryState &&
                now - retryState.lastAttemptAt < TX_FILTER_INVALID_FILTER_RETRY_INTERVAL_MS
            ) {
                continue;
            }

            try {
                const predicate = validateAndCompileRule(filter.rule);
                compiledFilters.set(filter.id, { ruleSignature, predicate });
                invalidFilterRetries.delete(filter.id);
                next.push({
                    id: filter.id,
                    description: filter.description,
                    ruleSignature,
                    predicate,
                });
            } catch (error) {
                compiledFilters.delete(filter.id);
                const attempts = Math.min(
                    (retryState?.attempts ?? 0) + 1,
                    TX_FILTER_INVALID_FILTER_MAX_ATTEMPTS,
                );
                invalidFilterRetries.set(filter.id, {
                    attempts,
                    lastAttemptAt: now,
                    ruleSignature,
                });

                console.error(
                    `[DynamicConfig] Invalid active transaction filter; filterId=${filter.id}; attempt=${attempts}/${TX_FILTER_INVALID_FILTER_MAX_ATTEMPTS}; reason=${formatError(error)}`,
                );

                if (attempts < TX_FILTER_INVALID_FILTER_MAX_ATTEMPTS) continue;

                try {
                    const deactivated = await deactivateInvalidTxFilter(filter.id, ruleSignature);
                    if (deactivated) {
                        invalidFilterRetries.delete(filter.id);
                        compiledFilters.delete(filter.id);
                        console.error(
                            `[DynamicConfig] Transaction filter automatically deactivated after ${attempts} consecutive invalid load attempts; filterId=${filter.id}`,
                        );
                    } else {
                        console.warn(
                            `[DynamicConfig] Automatic deactivation skipped because filter ${filter.id} was removed, deactivated, or changed in the database`,
                        );
                        invalidFilterRetries.delete(filter.id);
                    }
                } catch (deactivationError) {
                    console.error(
                        `[DynamicConfig] Failed to deactivate invalid transaction filter; filterId=${filter.id}; reason=${formatError(deactivationError)}`,
                    );
                }
            }
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
        validateAndCompileRule(data.rule);

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
        const updated = await withTxFilterMutationLock(async (transaction) => {
            const current = await findTxFilterForUpdate(id, transaction);
            if (!current) return null;

            if (updates.rule !== undefined || updates.isActive === true) {
                validateAndCompileRule(updates.rule ?? current.rule);
            }

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
