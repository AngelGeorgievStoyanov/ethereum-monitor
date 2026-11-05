import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTxFilter } from '../src/types/tx-filter.types';
import {
    DYNAMIC_CONFIG_FAST_REFRESH_INTERVAL_MS,
    DYNAMIC_CONFIG_SLOW_REFRESH_INTERVAL_MS,
} from '../src/constants/dynamic-config.constants';
import { TX_FILTER_RELOAD_RETRY_DELAYS_MS } from '../src/constants/tx-filter.constants';
import { getConfigurationService } from '../src/services/configurationService';
import { createDynamicConfigService } from '../src/services/dynamicConfigService';
import { getTxFilterService } from '../src/services/txFilterService';
import { mockActiveTxFilter, mockDynamicSettings } from './mock/dynamicConfigService.mock';

vi.mock('../src/services/configurationService', () => ({
    getConfigurationService: vi.fn(),
}));

vi.mock('../src/services/txFilterService', () => ({
    getTxFilterService: vi.fn(),
}));

const configurationServiceMock = {
    refresh: vi.fn<() => Promise<void>>(),
    getDynamicSettings: vi.fn(() => mockDynamicSettings),
};

const txFilterServiceMock = {
    loadActiveTxFilters: vi.fn<() => Promise<ActiveTxFilter[]>>(),
    setDynamicConfigRefreshHandler: vi.fn(),
};

describe('dynamicConfigService', () => {
    let service: ReturnType<typeof createDynamicConfigService>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        configurationServiceMock.refresh.mockResolvedValue(undefined);
        configurationServiceMock.getDynamicSettings.mockReturnValue(mockDynamicSettings);
        txFilterServiceMock.loadActiveTxFilters.mockResolvedValue([]);
        vi.mocked(getConfigurationService).mockReturnValue(configurationServiceMock as never);
        vi.mocked(getTxFilterService).mockReturnValue(txFilterServiceMock as never);
        service = createDynamicConfigService();
    });

    afterEach(() => {
        service.stopRefreshTimers();
        vi.useRealTimers();
    });

    it('loads configuration and filters before starting periodic refresh', async () => {
        const loadOrder: string[] = [];
        configurationServiceMock.refresh.mockImplementation(async () => {
            loadOrder.push('configuration');
        });
        txFilterServiceMock.loadActiveTxFilters.mockImplementation(async () => {
            loadOrder.push('filters');
            return [mockActiveTxFilter];
        });

        await service.init();

        expect(loadOrder).toEqual(['configuration', 'filters']);
        expect(service.getActiveTxFilterConfig().filters).toEqual([mockActiveTxFilter]);
        expect(txFilterServiceMock.setDynamicConfigRefreshHandler).toHaveBeenCalledOnce();
    });

    it('uses the fast interval to reload filters without reloading settings', async () => {
        await service.init();

        await vi.advanceTimersByTimeAsync(DYNAMIC_CONFIG_FAST_REFRESH_INTERVAL_MS);

        expect(txFilterServiceMock.loadActiveTxFilters).toHaveBeenCalledTimes(2);
        expect(configurationServiceMock.refresh).toHaveBeenCalledOnce();
    });

    it('uses the slow interval to reload both settings and filters', async () => {
        await service.init();

        await vi.advanceTimersByTimeAsync(DYNAMIC_CONFIG_SLOW_REFRESH_INTERVAL_MS);

        expect(configurationServiceMock.refresh).toHaveBeenCalledTimes(2);
        expect(txFilterServiceMock.loadActiveTxFilters).toHaveBeenCalledTimes(4);
    });

    it('does not initialize or start duplicate refresh intervals twice', async () => {
        await service.init();
        await service.init();

        expect(configurationServiceMock.refresh).toHaveBeenCalledOnce();
        expect(txFilterServiceMock.loadActiveTxFilters).toHaveBeenCalledOnce();
    });

    it('retains the last valid filters when a periodic reload fails', async () => {
        txFilterServiceMock.loadActiveTxFilters
            .mockResolvedValueOnce([mockActiveTxFilter])
            .mockRejectedValue(new Error('repository unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await service.init();
        const initialVersion = service.getActiveTxFilterConfig().version;

        const retryDuration = TX_FILTER_RELOAD_RETRY_DELAYS_MS.reduce(
            (total, delay) => total + delay,
            0,
        );
        await vi.advanceTimersByTimeAsync(
            DYNAMIC_CONFIG_FAST_REFRESH_INTERVAL_MS + retryDuration,
        );

        expect(service.getActiveTxFilterConfig()).toMatchObject({
            version: initialVersion,
            filters: [mockActiveTxFilter],
        });
    });

    it('does not start periodic refresh when the initial filter load fails', async () => {
        txFilterServiceMock.loadActiveTxFilters.mockRejectedValue(
            new Error('repository unavailable'),
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const initialization = service.init();
        const initializationRejection = expect(initialization).rejects.toThrow(
            'Unable to load required dynamic configuration',
        );
        await vi.advanceTimersByTimeAsync(
            TX_FILTER_RELOAD_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0),
        );

        await initializationRejection;
        expect(service.getActiveTxFilterConfig).toThrow(
            'Dynamic configuration has not been initialized',
        );
    });
});
