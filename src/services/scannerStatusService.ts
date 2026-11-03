import { SCANNER_ID } from '../constants/scanner.constants';
import { findScannerStatusState } from '../repositories/scannerStateRepository';
import { findLatestScannerRescanJob } from '../repositories/scannerRescanJobRepository';
import { getScannerRuntimeMetrics } from './metricsAggregatorService';
import { getScannerControlState } from './scannerControlService';
import { getRecoveryMetrics } from './recoveryMetrics';
import { getBlockProcessingMetrics } from './scannerMetrics';
import { getDynamicConfigService } from './dynamicConfigService';
import { mapScannerStatusResponse } from '../mappers/scannerStatusMapper';
import type { ScannerStatusResponse } from '../types/scanner-status.types';

type RuntimeStatusMetrics = {
    scanner?: { running?: boolean; uptimeSeconds?: number; activeFiltersCount?: number };
    recovery?: Record<string, number>;
    chain?: {
        latestFinalizedBlock?: number | null;
        latestFinalizedAt?: string | null;
        lastProcessedBlock?: number | null;
        lagBlocks?: number | null;
        finalizedRegression?: boolean;
        finalizedRegressionMessage?: string | null;
        rpcAvailable?: boolean | null;
    };
    rpc?: {
        endpoints?: Array<{
            index: number;
            attempts: number;
            successes: number;
            failures: number;
            retryableFailures: number;
            totalDurationMs: number;
            lastFailureAt: string | null;
        }>;
    };
};

/**
 * Loads persistent scanner state and publishes a ready-to-read runtime snapshot.
 * This function is called during scanner initialization and after scanner lock
 * reacquisition, never by the Dashboard request path. Routine checkpoint,
 * control, and rescan changes publish smaller snapshot updates directly.
 */
export async function refreshScannerStatusSnapshot(): Promise<ScannerStatusResponse> {
    const [control, state, rescanJob] = await Promise.all([
        getScannerControlState(),
        findScannerStatusState(SCANNER_ID),
        findLatestScannerRescanJob(),
    ]);

    const runtimeMetrics = getScannerRuntimeMetrics() as RuntimeStatusMetrics | null;
    const latestFinalizedBlock = runtimeMetrics?.chain?.latestFinalizedBlock ?? null;
    const latestFinalizedAt = runtimeMetrics?.chain?.latestFinalizedAt ?? null;
    const rpcAvailable = runtimeMetrics?.chain?.rpcAvailable ?? false;
    const lagBlocks = runtimeMetrics?.chain?.lagBlocks ?? null;
    const finalizedRegression = runtimeMetrics?.chain?.finalizedRegression ?? false;
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
        scannerRunning: runtimeMetrics?.scanner?.running ?? false,
        state,
        rescanJob,
        recoveryMetrics:
            (runtimeMetrics?.recovery as ReturnType<typeof getRecoveryMetrics> | undefined) ??
            getRecoveryMetrics(),
        processingMetrics: getBlockProcessingMetrics(),
        activeFiltersCount:
            runtimeMetrics?.scanner?.activeFiltersCount ??
            getDynamicConfigService().getTxFilters().length,
        processUptimeSeconds: runtimeMetrics?.scanner?.uptimeSeconds ?? Math.floor(process.uptime()),
        latestFinalizedBlock,
        latestFinalizedAt,
        lagBlocks,
        finalizedRegression,
        finalizedRegressionMessage: runtimeMetrics?.chain?.finalizedRegressionMessage ?? null,
        rpcAvailable,
        rpcMetrics,
        checkedAt: new Date().toISOString(),
    });

    getDynamicConfigService().publishScannerStatus(response);
    return response;
}

/**
 * Dashboard reads only this in-memory snapshot. It performs no database or RPC calls.
 */
export function getScannerStatusResponse(): ScannerStatusResponse {
    const snapshot = getDynamicConfigService().getScannerStatusSnapshot();
    if (!snapshot) {
        throw new Error('Scanner status is still initializing');
    }
    return snapshot as ScannerStatusResponse;
}
