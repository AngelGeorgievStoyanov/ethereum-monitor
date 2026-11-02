import type { RecoveryMetrics } from '../types/scanner-status.types';
import { updateScannerRuntimeContext } from './metricsAggregatorService';

const metrics: RecoveryMetrics = {
    reorgCount: 0,
    reorgDepthLast: 0,
    reorgDepthMax: 0,
    reorgRecoveryDurationMsLast: 0,
    reorgConsensusFailuresTotal: 0,
    reorgBlocksReprocessedTotal: 0,
    rescanRunsTotal: 0,
    rescanBlocksProcessedTotal: 0,
    rescanFailuresTotal: 0,
};

let recoveryStartedAt: number | null = null;

function publishRecoveryMetrics(): void {
    updateScannerRuntimeContext({ recovery: metrics });
}

export function recordReorgDetected(): void {
    metrics.reorgCount += 1;
    recoveryStartedAt = Date.now();
    publishRecoveryMetrics();
}

export function recordReorgAncestorFound(depth: number): void {
    metrics.reorgDepthLast = depth;
    metrics.reorgDepthMax = Math.max(metrics.reorgDepthMax, depth);
    publishRecoveryMetrics();
}

export function recordReorgBlockReprocessed(): void {
    metrics.reorgBlocksReprocessedTotal += 1;
    publishRecoveryMetrics();
}

export function recordReorgRecoveryCompleted(): void {
    if (recoveryStartedAt !== null) {
        metrics.reorgRecoveryDurationMsLast = Date.now() - recoveryStartedAt;
    }
    recoveryStartedAt = null;
    publishRecoveryMetrics();
}

export function recordReorgConsensusFailure(): void {
    metrics.reorgConsensusFailuresTotal += 1;
    publishRecoveryMetrics();
}

export function recordRescanStarted(): void {
    metrics.rescanRunsTotal += 1;
    publishRecoveryMetrics();
}

export function recordRescanBlockProcessed(): void {
    metrics.rescanBlocksProcessedTotal += 1;
    publishRecoveryMetrics();
}

export function recordRescanFailure(): void {
    metrics.rescanFailuresTotal += 1;
    publishRecoveryMetrics();
}

export function getRecoveryMetrics(): RecoveryMetrics {
    return { ...metrics };
}
