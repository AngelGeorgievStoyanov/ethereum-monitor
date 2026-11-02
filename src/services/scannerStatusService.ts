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
        chain?: { latestFinalizedBlock?: number | null; rpcAvailable?: boolean | null };
        rpc?: { endpoints?: Array<{ index: number; attempts: number; successes: number; failures: number; averageLatencyMs: number | null }> };
    } | null;
    const latestFinalizedBlock = runtimeMetrics?.chain?.latestFinalizedBlock ?? null;
    const rpcAvailable = runtimeMetrics?.chain?.rpcAvailable ?? false;
    const rpcMetrics = (runtimeMetrics?.rpc?.endpoints ?? []).map((endpoint) => ({
        index: endpoint.index,
        attempts: endpoint.attempts,
        successes: endpoint.successes,
        failures: endpoint.failures,
        retryableFailures: endpoint.failures,
        totalDurationMs: endpoint.averageLatencyMs === null ? 0 : endpoint.averageLatencyMs * endpoint.attempts,
        lastFailureAt: null,
    }));

    const response = mapScannerStatusResponse({
        control,
        state,
        rescanJob,
        recoveryMetrics: getRecoveryMetrics(),
        processingMetrics: getBlockProcessingMetrics(),
        activeFiltersCount: getDynamicConfigService().getTxFilters().length,
        processUptimeSeconds: Math.floor(process.uptime()),
        latestFinalizedBlock,
        rpcAvailable,
        rpcMetrics,
        checkedAt: new Date().toISOString(),
    });
    getDynamicConfigService().publishScannerStatus(response);
    return getDynamicConfigService().getScannerStatusSnapshot() as typeof response;
}
