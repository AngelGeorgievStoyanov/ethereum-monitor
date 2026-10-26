import TxFilter from '../models/txFilter';
import {
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
} from '../repositories/txFilterRepository';
import { findRuleForFilter, saveRuleForFilter } from '../repositories/txFilterRuleRepository';
import { getNextFilterStartBlock } from './txFilterActivationService';
import {
    ActiveTxFilter,
    TxFilterGroupRule,
    validateTxFilterGroup,
} from './txFilterEvaluatorService';

function legacyRule(txFilter: TxFilter): TxFilterGroupRule | null {
    const conditions = [];
    if (txFilter.from) conditions.push({ field: 'from', operator: 'eq', value: txFilter.from });
    if (txFilter.to) conditions.push({ field: 'to', operator: 'eq', value: txFilter.to });
    return conditions.length ? { logic: 'AND', conditions, groups: [] } : null;
}

export function createTxFilterService() {
    const txFilters = new Map<number, ActiveTxFilter>();

    async function loadTxFilters() {
        const activeFilters = await findActiveTxFilters();
        const next = new Map<number, ActiveTxFilter>();
        for (const filter of activeFilters) {
            const rule = (await findRuleForFilter(filter.id)) ?? legacyRule(filter);
            if (!rule) continue;
            if (filter.activeFromBlock === null || filter.activeFromBlock === undefined) {
                const startBlock = await getNextFilterStartBlock();
                filter.activeFromBlock = startBlock;
                await filter.save();
            }
            next.set(filter.id, {
                id: filter.id,
                isActive: filter.isActive,
                activeFromBlock: filter.activeFromBlock,
                rule,
            });
        }
        txFilters.clear();
        for (const [id, filter] of next) txFilters.set(id, filter);
        console.log(`[Scanner] Loaded ${txFilters.size} active tx filter(s)`);
    }

    async function refreshFilter(filter: TxFilter | null) {
        if (!filter || !filter.isActive) {
            if (filter) txFilters.delete(filter.id);
            return;
        }
        const rule = (await findRuleForFilter(filter.id)) ?? legacyRule(filter);
        if (!rule) {
            txFilters.delete(filter.id);
            return;
        }
        txFilters.set(filter.id, {
            id: filter.id,
            isActive: filter.isActive,
            activeFromBlock: filter.activeFromBlock,
            rule,
        });
    }

    async function getAllTxFilters() {
        return findAllTxFilters();
    }

    async function createTxFilter(data: {
        description: string;
        from?: string | null;
        to?: string | null;
        isActive: boolean;
        rule?: TxFilterGroupRule;
    }) {
        if (data.rule) validateTxFilterGroup(data.rule);
        const activeFromBlock = data.isActive ? await getNextFilterStartBlock() : null;
        const filter = await insertTxFilter({
            description: data.description,
            from: data.from ?? null,
            to: data.to ?? null,
            isActive: data.isActive,
            activeFromBlock,
        });
        if (data.rule) await saveRuleForFilter(filter.id, data.rule);
        await refreshFilter(filter);
        return filter;
    }

    async function updateTxFilter(
        id: number,
        updates: {
            description?: string;
            from?: string | null;
            to?: string | null;
            isActive?: boolean;
            rule?: TxFilterGroupRule;
        },
    ) {
        if (updates.rule) validateTxFilterGroup(updates.rule);
        const existing = await findAllTxFilters();
        const current = existing.find((item) => item.id === id);
        if (!current) return null;

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

        const filter = await persistTxFilter(id, {
            ...(updates.description !== undefined ? { description: updates.description } : {}),
            ...(updates.from !== undefined ? { from: updates.from } : {}),
            ...(updates.to !== undefined ? { to: updates.to } : {}),
            ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
            ...(activeFromBlock !== undefined ? { activeFromBlock } : {}),
        });
        if (updates.rule !== undefined) await saveRuleForFilter(id, updates.rule);
        await refreshFilter(filter);
        return filter;
    }

    async function removeTxFilter(id: number) {
        txFilters.delete(id);
        return deleteTxFilterById(id);
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
