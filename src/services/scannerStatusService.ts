import { SCANNER_ID } from '../constants/scanner.constants';
import { findScannerStatusState } from '../repositories/scannerStateRepository';
import { findLatestScannerRescanJob } from '../repositories/scannerRescanJobRepository';
import { getCurrentMetrics } from './metricsAggregatorService';
import { getScannerControlState } from './scannerControlService';
import { getRecoveryMetrics } from './recoveryMetrics';
import { getBlockProcessingMetrics } from './scannerMetrics';
import { getDynamicConfigService } from './dynamicConfigService';
import { mapScannerStatusResponse } from '../mappers/scannerStatusMapper';
import type { ScannerStatusResponse } from '../types/scanner-status.types';

type CurrentMetrics = {
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
            rateLimitFailures: number;
            totalDurationMs: number;
            lastFailureAt: string | null;
            lastFailureKind: string | null;
            lastHttpStatus: number | null;
            lastRpcCode: number | null;
            lastFailureMessage: string | null;
        }>;
    };
};

/**
 * Loads persistent scanner state and publishes a ready-to-read current status.
 * This function is called during scanner initialization and after scanner lock
 * reacquisition, never by the Dashboard request path. Routine checkpoint,
 * control, and rescan changes publish smaller status updates directly.
 */
export async function refreshScannerStatus(): Promise<ScannerStatusResponse> {
    const [control, state, rescanJob] = await Promise.all([
        getScannerControlState(),
        findScannerStatusState(SCANNER_ID),
        findLatestScannerRescanJob(),
    ]);

    const currentMetrics = getCurrentMetrics() as CurrentMetrics | null;
    const latestFinalizedBlock = currentMetrics?.chain?.latestFinalizedBlock ?? null;
    const latestFinalizedAt = currentMetrics?.chain?.latestFinalizedAt ?? null;
    const rpcAvailable = currentMetrics?.chain?.rpcAvailable ?? false;
    const lagBlocks = currentMetrics?.chain?.lagBlocks ?? null;
    const finalizedRegression = currentMetrics?.chain?.finalizedRegression ?? false;
    const rpcMetrics = (currentMetrics?.rpc?.endpoints ?? []).map((endpoint) => ({
        index: endpoint.index,
        attempts: endpoint.attempts,
        successes: endpoint.successes,
        failures: endpoint.failures,
        retryableFailures: endpoint.retryableFailures,
        rateLimitFailures: endpoint.rateLimitFailures,
        totalDurationMs: endpoint.totalDurationMs,
        lastFailureAt: endpoint.lastFailureAt,
        lastFailureKind: endpoint.lastFailureKind,
        lastHttpStatus: endpoint.lastHttpStatus,
        lastRpcCode: endpoint.lastRpcCode,
        lastFailureMessage: endpoint.lastFailureMessage,
    }));

    const response = mapScannerStatusResponse({
        control,
        scannerRunning: currentMetrics?.scanner?.running ?? false,
        state,
        rescanJob,
        recoveryMetrics:
            (currentMetrics?.recovery as ReturnType<typeof getRecoveryMetrics> | undefined) ??
            getRecoveryMetrics(),
        processingMetrics: getBlockProcessingMetrics(),
        activeFiltersCount:
            currentMetrics?.scanner?.activeFiltersCount ??
            getDynamicConfigService().getTxFilters().length,
        processUptimeSeconds:
            currentMetrics?.scanner?.uptimeSeconds ?? Math.floor(process.uptime()),
        latestFinalizedBlock,
        latestFinalizedAt,
        lagBlocks,
        finalizedRegression,
        finalizedRegressionMessage: currentMetrics?.chain?.finalizedRegressionMessage ?? null,
        rpcAvailable,
        rpcMetrics,
        checkedAt: new Date().toISOString(),
    });

    getDynamicConfigService().publishScannerStatus(response);
    return response;
}

/**
 * Dashboard reads only this in-memory status. It performs no database or RPC calls.
 */
export function getScannerStatusResponse(): ScannerStatusResponse {
    const status = getDynamicConfigService().getScannerStatus();
    if (!status) {
        throw new Error('Scanner status is still initializing');
    }
    return status as ScannerStatusResponse;
}
