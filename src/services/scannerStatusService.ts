import { SCANNER_ID } from '../constants/scanner.constants';
import { findScannerStatusState } from '../repositories/scannerStateRepository';
import { findLatestScannerRescanJob } from '../repositories/scannerRescanJobRepository';
import { getScannerRuntimeMetrics } from './metricsAggregatorService';
import { getScannerControlState } from './scannerControlService';
import { getRecoveryMetrics } from './recoveryMetrics';
import { getBlockProcessingMetrics } from './scannerMetrics';
import { getDynamicConfigService } from './dynamicConfigService';
import { mapScannerStatusResponse } from '../mappers/scannerStatusMapper';

export async function getScannerStatusResponse() {
    const [control, state, rescanJob] = await Promise.all([
        getScannerControlState(),
        findScannerStatusState(SCANNER_ID),
        findLatestScannerRescanJob(),
    ]);

    const runtimeMetrics = getScannerRuntimeMetrics() as {
        scanner?: { uptimeSeconds?: number; activeFiltersCount?: number };
        recovery?: Record<string, number>;
        chain?: { latestFinalizedBlock?: number | null; latestFinalizedAt?: string | null; lastProcessedBlock?: number | null; lagBlocks?: number | null; rpcAvailable?: boolean | null };
        rpc?: { endpoints?: Array<{ index: number; attempts: number; successes: number; failures: number; retryableFailures: number; totalDurationMs: number; lastFailureAt: string | null }> };
    } | null;
    const latestFinalizedBlock = runtimeMetrics?.chain?.latestFinalizedBlock ?? null;
    const latestFinalizedAt = runtimeMetrics?.chain?.latestFinalizedAt ?? null;
    const rpcAvailable = runtimeMetrics?.chain?.rpcAvailable ?? false;
    const lagBlocks = runtimeMetrics?.chain?.lagBlocks ?? null;
    const rpcMetrics = (runtimeMetrics?.rpc?.endpoints ?? []).map((endpoint) => ({
        index: endpoint.index,
        attempts: endpoint.attempts,
        successes: endpoint.successes,
        failures: endpoint.failures,
        retryableFailures: endpoint.retryableFailures,
        totalDurationMs: endpoint.totalDurationMs,
        lastFailureAt: endpoint.lastFailureAt,
    }));

    const response = mapScannerStatusResponse({
        control,
        state,
        rescanJob,
        recoveryMetrics: (runtimeMetrics?.recovery as ReturnType<typeof getRecoveryMetrics> | undefined) ?? getRecoveryMetrics(),
        processingMetrics: getBlockProcessingMetrics(),
        activeFiltersCount: runtimeMetrics?.scanner?.activeFiltersCount ?? getDynamicConfigService().getTxFilters().length,
        processUptimeSeconds: runtimeMetrics?.scanner?.uptimeSeconds ?? Math.floor(process.uptime()),
        latestFinalizedBlock,
        latestFinalizedAt,
        lagBlocks,
        rpcAvailable,
        rpcMetrics,
        checkedAt: new Date().toISOString(),
    });
    getDynamicConfigService().publishScannerStatus(response);
    return getDynamicConfigService().getScannerStatusSnapshot() as typeof response;
}
