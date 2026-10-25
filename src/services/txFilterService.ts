import TxFilter from '../models/txFilter';
import {
    createTxFilter as insertTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    updateTxFilter as persistTxFilter,
} from '../repositories/txFilterRepository';

export function createTxFilterService() {
    const txFilters = new Map<string, TxFilter>();

    async function loadTxFilters() {
        const configs = await findActiveTxFilters();
        txFilters.clear();
        configs.forEach((config) => txFilters.set(config.id, config));
        console.log(`[Scanner] Loaded ${txFilters.size} active txFilter(s)`);
    }

    function syncTxFilter(config: TxFilter) {
        if (config.isActive) txFilters.set(config.id, config);
        else txFilters.delete(config.id);
    }

    async function getAllTxFilters() {
        return findAllTxFilters();
    }

    async function createTxFilter(data: {
        name: string;
        senderAddress: string | null;
        recipientAddress: string | null;
        isActive: boolean;
    }) {
        const txFilter = await insertTxFilter(data);
        syncTxFilter(txFilter);
        return txFilter;
    }

    async function updateTxFilter(
        id: string,
        updates: {
            name?: string;
            senderAddress?: string | null;
            recipientAddress?: string | null;
            isActive?: boolean;
        },
    ) {
        const txFilter = await persistTxFilter(id, updates);
        if (txFilter) syncTxFilter(txFilter);
        return txFilter;
    }

    async function removeTxFilter(id: string) {
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
