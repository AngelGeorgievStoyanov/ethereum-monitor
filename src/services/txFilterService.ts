import TxFilter from '../models/txFilter';
import {
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
} from '../repositories/txFilterRepository';

export function createTxFilterService() {
    const txFilters = new Map<number, TxFilter>();

    async function loadTxFilters() {
        const activeTxFilters = await findActiveTxFilters();
        txFilters.clear();
        activeTxFilters.forEach((txFilter) => txFilters.set(txFilter.id, txFilter));
        console.log(`[Scanner] Loaded ${txFilters.size} active tx filter(s)`);
    }

    function syncTxFilter(txFilter: TxFilter) {
        if (txFilter.isActive) txFilters.set(txFilter.id, txFilter);
        else txFilters.delete(txFilter.id);
    }

    async function getAllTxFilters() {
        return findAllTxFilters();
    }

    async function createTxFilter(data: {
        description: string;
        from: string | null;
        to: string | null;
        isActive: boolean;
    }) {
        const txFilter = await insertTxFilter(data);
        syncTxFilter(txFilter);
        return txFilter;
    }

    async function updateTxFilter(
        id: number,
        updates: {
            description?: string;
            from?: string | null;
            to?: string | null;
            isActive?: boolean;
        },
    ) {
        const txFilter = await persistTxFilter(id, updates);
        if (txFilter) syncTxFilter(txFilter);
        return txFilter;
    }

    async function removeTxFilter(id: number) {
        const deleted = await deleteTxFilterById(id);
        if (deleted > 0) txFilters.delete(id);
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
    if (!txFilterServiceInstance) {
        txFilterServiceInstance = createTxFilterService();
    }
    return txFilterServiceInstance;
}
