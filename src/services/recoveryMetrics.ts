interface RecoveryMetrics {
    reorgCount: number;
    reorgDepthLast: number;
    reorgDepthMax: number;
    reorgRecoveryDurationMsLast: number;
    reorgConsensusFailuresTotal: number;
    reorgBlocksReprocessedTotal: number;
    rescanRunsTotal: number;
    rescanBlocksProcessedTotal: number;
    rescanFailuresTotal: number;
}

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

export function recordReorgDetected(): void {
    metrics.reorgCount += 1;
    recoveryStartedAt = Date.now();
}

export function recordReorgAncestorFound(depth: number): void {
    metrics.reorgDepthLast = depth;
    metrics.reorgDepthMax = Math.max(metrics.reorgDepthMax, depth);
}

export function recordReorgBlockReprocessed(): void {
    metrics.reorgBlocksReprocessedTotal += 1;
}

export function recordReorgRecoveryCompleted(): void {
    if (recoveryStartedAt !== null) {
        metrics.reorgRecoveryDurationMsLast = Date.now() - recoveryStartedAt;
    }
    recoveryStartedAt = null;
}

export function recordReorgConsensusFailure(): void {
    metrics.reorgConsensusFailuresTotal += 1;
}

export function recordRescanStarted(): void {
    metrics.rescanRunsTotal += 1;
}

export function recordRescanBlockProcessed(): void {
    metrics.rescanBlocksProcessedTotal += 1;
}

export function recordRescanFailure(): void {
    metrics.rescanFailuresTotal += 1;
}

export function getRecoveryMetrics(): RecoveryMetrics {
    return { ...metrics };
}
