import { beforeEach, describe, expect, it, vi } from 'vitest';
import Configuration from '../src/models/configuration';
import { createConfigurationService } from '../src/services/configurationService';
import { configurationRows, refreshedConfigurationRows } from './mock/configurationService.mock';

vi.mock('../src/models/configuration', () => ({
    default: {
        findAll: vi.fn(),
    },
}));

describe('configurationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads configuration rows and exposes dynamic settings', async () => {
        vi.mocked(Configuration.findAll).mockResolvedValue(configurationRows as never);
        const service = createConfigurationService();

        await service.refresh();

        expect(Configuration.findAll).toHaveBeenCalledWith({
            attributes: ['settingKey', 'value'],
        });
        expect(service.getDynamicSettings()).toEqual({
            maxParallelBlocks: '3',
            pollIntervalMs: '4000',
        });
    });

    it('returns a copy of the current settings rather than its internal object', async () => {
        vi.mocked(Configuration.findAll).mockResolvedValue(configurationRows as never);
        const service = createConfigurationService();

        await service.refresh();
        const settings = service.getDynamicSettings();
        settings.maxParallelBlocks = '999';

        expect(service.getDynamicSettings().maxParallelBlocks).toBe('3');
    });

    it('replaces settings after a successful refresh', async () => {
        vi.mocked(Configuration.findAll)
            .mockResolvedValueOnce(configurationRows as never)
            .mockResolvedValueOnce(refreshedConfigurationRows as never);
        const service = createConfigurationService();

        await service.refresh();
        await service.refresh();

        expect(service.getDynamicSettings()).toEqual({
            maxParallelBlocks: '5',
            pollIntervalMs: '6000',
        });
    });

    it('retains the last valid settings when a refresh fails', async () => {
        vi.mocked(Configuration.findAll)
            .mockResolvedValueOnce(configurationRows as never)
            .mockRejectedValueOnce(new Error('database unavailable'));
        const service = createConfigurationService();

        await service.refresh();
        await service.refresh();

        expect(service.getDynamicSettings()).toEqual({
            maxParallelBlocks: '3',
            pollIntervalMs: '4000',
        });
    });
});
