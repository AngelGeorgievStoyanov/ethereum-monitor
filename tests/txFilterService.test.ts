import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ACTIVE_TX_FILTERS } from '../src/constants/tx-filter.constants';
import {
    countActiveTxFilters,
    createTxFilter as insertTxFilter,
    deactivateInvalidTxFilter,
    deleteTxFilterById,
    findActiveTxFilters,
    findAllTxFilters,
    findTxFilterForUpdate,
    updateTxFilter as persistTxFilter,
    withTxFilterMutationLock,
} from '../src/repositories/txFilterRepository';
import { createTxFilterService } from '../src/services/txFilterService';
import { ValidationError } from '../src/utils/validationError';
import {
    activeNativeFilter,
    invalidActiveFilter,
    validNativeRule,
} from './mock/txFilterService.mock';

vi.mock('../src/repositories/txFilterRepository', () => ({
    countActiveTxFilters: vi.fn(),
    createTxFilter: vi.fn(),
    deactivateInvalidTxFilter: vi.fn(),
    deleteTxFilterById: vi.fn(),
    findActiveTxFilters: vi.fn(),
    findAllTxFilters: vi.fn(),
    findTxFilterForUpdate: vi.fn(),
    updateTxFilter: vi.fn(),
    withTxFilterMutationLock: vi.fn(),
}));

describe('txFilterService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(withTxFilterMutationLock).mockImplementation(async (operation) =>
            operation({} as never),
        );
        vi.mocked(findActiveTxFilters).mockResolvedValue([]);
        vi.mocked(findAllTxFilters).mockResolvedValue([]);
        vi.mocked(countActiveTxFilters).mockResolvedValue(0);
        vi.mocked(deactivateInvalidTxFilter).mockResolvedValue(false);
        vi.mocked(deleteTxFilterById).mockResolvedValue(0);
    });

    it('loads and compiles active filters for runtime use', async () => {
        vi.mocked(findActiveTxFilters).mockResolvedValue([activeNativeFilter]);
        const service = createTxFilterService();

        const loaded = await service.loadActiveTxFilters();

        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe(activeNativeFilter.id);
        expect(loaded[0].predicate({ tx: { transferType: 'native' } })).toBe(true);
        expect(loaded[0].predicate({ tx: { transferType: 'erc20' } })).toBe(false);
        expect(service.getTxFilters()).toEqual(loaded);
    });

    it('does not expose invalid active filters to the scanner', async () => {
        vi.mocked(findActiveTxFilters).mockResolvedValue([invalidActiveFilter]);
        const service = createTxFilterService();

        await expect(service.loadActiveTxFilters()).resolves.toEqual([]);
        expect(service.getTxFilters()).toEqual([]);
        expect(deactivateInvalidTxFilter).not.toHaveBeenCalled();
    });

    it('rejects invalid rules before attempting a database mutation', async () => {
        const service = createTxFilterService();

        await expect(
            service.createTxFilter({
                description: 'Invalid',
                isActive: true,
                rule: { field: 'unknown', op: 'eq', value: 'x' },
            }),
        ).rejects.toBeInstanceOf(ValidationError);

        expect(withTxFilterMutationLock).not.toHaveBeenCalled();
        expect(insertTxFilter).not.toHaveBeenCalled();
    });

    it('creates a filter and refreshes the scanner configuration', async () => {
        vi.mocked(insertTxFilter).mockResolvedValue(activeNativeFilter);
        const refreshHandler = vi.fn().mockResolvedValue(true);
        const service = createTxFilterService();
        service.setDynamicConfigRefreshHandler(refreshHandler);

        const result = await service.createTxFilter({
            description: activeNativeFilter.description,
            isActive: true,
            rule: validNativeRule,
        });

        expect(result).toEqual(activeNativeFilter);
        expect(countActiveTxFilters).toHaveBeenCalledOnce();
        expect(insertTxFilter).toHaveBeenCalledOnce();
        expect(refreshHandler).toHaveBeenCalledOnce();
    });

    it('enforces the active filter limit before inserting a new active filter', async () => {
        vi.mocked(countActiveTxFilters).mockResolvedValue(MAX_ACTIVE_TX_FILTERS);
        const service = createTxFilterService();

        await expect(
            service.createTxFilter({
                description: 'One too many',
                isActive: true,
                rule: validNativeRule,
            }),
        ).rejects.toThrow(`maximum of ${MAX_ACTIVE_TX_FILTERS} active transaction filters`);

        expect(insertTxFilter).not.toHaveBeenCalled();
    });

    it('reports scanner sync failure after a successful database mutation', async () => {
        vi.mocked(insertTxFilter).mockResolvedValue(activeNativeFilter);
        const refreshHandler = vi.fn().mockResolvedValue(false);
        const service = createTxFilterService();
        service.setDynamicConfigRefreshHandler(refreshHandler);

        await expect(
            service.createTxFilter({
                description: activeNativeFilter.description,
                isActive: true,
                rule: validNativeRule,
            }),
        ).rejects.toMatchObject({
            name: 'TxFilterSyncError',
            response: { scannerSync: 'out_of_sync' },
        });
        expect(refreshHandler).toHaveBeenCalledOnce();
    });

    it('returns null when updating a filter that no longer exists', async () => {
        vi.mocked(findTxFilterForUpdate).mockResolvedValue(null);
        const refreshHandler = vi.fn().mockResolvedValue(true);
        const service = createTxFilterService();
        service.setDynamicConfigRefreshHandler(refreshHandler);

        await expect(service.updateTxFilter(999, { description: 'Updated' })).resolves.toBeNull();
        expect(persistTxFilter).not.toHaveBeenCalled();
        expect(refreshHandler).not.toHaveBeenCalled();
    });

    it('refreshes the scanner after deleting an existing filter', async () => {
        vi.mocked(deleteTxFilterById).mockResolvedValue(1);
        const refreshHandler = vi.fn().mockResolvedValue(true);
        const service = createTxFilterService();
        service.setDynamicConfigRefreshHandler(refreshHandler);

        await expect(service.removeTxFilter(1)).resolves.toBe(1);
        expect(refreshHandler).toHaveBeenCalledOnce();
    });
});
