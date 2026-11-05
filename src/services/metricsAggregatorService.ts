import type { ScannerAnalyticsResponse } from '../types/scanner-analytics.types';
import { performance } from 'node:perf_hooks';
import { getDynamicConfigService } from './dynamicConfigService';
import {
    subscribeToRpcMetricEvents,
    subscribeToRpcOperationMetricEvents,
    type RpcMetricEventInput,
    type RpcOperationMetricEvent,
} from '../metrics/metricsEventBus';
import {
    FINALIZED_REGRESSION_WAIT_MS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
} from '../constants/scanner.constants';
import { classifyRpcError } from '../utils/classifyRpcError';
import {
    subscribeToDatabaseMetricEvents,
    type DatabaseMetricEvent,
} from '../metrics/databaseMetricsEventBus';
import {
    subscribeToFilterMetricEvents,
    type FilterMetricEvent,
} from '../metrics/filterMetricsEventBus';
import {
    METRICS_RETENTION_MS,
    METRICS_SAMPLE_LIMITS,
    DEFAULT_METRICS_WINDOW,
    METRICS_TIME_WINDOWS,
    METRICS_BUCKET_INTERVAL_MS,
    METRICS_MAX_BUCKETS,
    METRICS_RPC_EVENT_COMPACTION_THRESHOLD,
    METRICS_SAMPLE_COMPACTION_THRESHOLD,
    METRICS_RECENT_BLOCK_WINDOW_MS,
    METRICS_RECENT_RATE_WINDOW_MS,
    METRICS_FINALIZED_SAMPLE_WINDOW_MS,
    METRICS_CATCH_UP_ETA_MIN_DURATION_MS,
    METRICS_MIN_ANALYTICS_WINDOW_MS,
    METRICS_ANALYTICS_RECENT_RPC_ERRORS,
    METRICS_PUBLISH_INTERVAL_MS,
    METRICS_ANALYTICS_REFRESH_INTERVAL_MS,
} from '../constants/scanner-metrics.constants';

type BlockInput = {
    blockNumber: number;
    transactionCount: number;
    blockDurationMs: number;
    fetchDurationMs: number;
    getBlockDurationMs: number;
    getBlockReceiptsDurationMs: number;
    filterMatchingDurationMs: number;
    databaseWriteDurationMs: number;
    nativeTransfersSeen: number;
    nativeMatches: number;
    erc20TransferLogsSeen: number;
    erc20Matches: number;
    erc20FailedAttemptsSeen: number;
    erc20FailedAttemptsMatched: number;
};

type RpcInput = RpcMetricEventInput;

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
let lastCpuUsage = process.cpuUsage();
let lastCpuSampleAt = startedAtMs;
let lastEventLoopUtilization = performance.eventLoopUtilization();
const blockSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
let blockSamplesStartIndex = 0;
const rpcEvents: Array<Record<string, unknown> & { timestampMs: number }> = [];
let rpcEventsStartIndex = 0;
const catchUpSessions: Array<Record<string, unknown> & { startedAtMs: number }> = [];
const batchSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const finalizedSamples: Array<{ timestampMs: number; blockNumber: number }> = [];
const lagSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
let lagSamplesStartIndex = 0;
type MinuteMetricBucket = {
    timestamp: string;
    timestampMs: number;
    processedBlocks: number;
    processedTransactions: number;
    blockDurationMsTotal: number;
    blockFilterDurationMsTotal: number;
    databaseBatchWriteDurationMsTotal: number;
    rpcRequests: number;
    rpcFailures: number;
    rpcRateLimitErrors: number;
    rpcTimeoutErrors: number;
    rpcConnectionErrors: number;
    rpcProviderErrors: number;
    rpcJsonRpcErrors: number;
    rpcOtherErrors: number;
    rpcRetryableFailures: number;
    logicalRpcOperations: number;
    successfulOperationAttempts: number;
    rpcRetriedOperations: number;
    rpcRetryAttempts: number;
    rpcEndpointFailovers: number;
    rpcOperationFailures: number;
    rpcDurationMsTotal: number;
    databaseQueries: number;
    databaseReads: number;
    databaseWrites: number;
    databaseOther: number;
    databaseFailures: number;
    databaseDurationMsTotal: number;
    filterEvaluations: number;
    filterMatches: number;
    filterFailures: number;
    predicateDurationMsTotal: number;
    lagBlocksSum: number;
    lagSamples: number;
    latestLagBlocks: number | null;
    processingBatches: number;
    batchDurationMsTotal: number;
    rpcMethods: Record<
        string,
        { requests: number; successes: number; failures: number; totalDurationMs: number }
    >;
    filtersById: Record<
        string,
        { evaluations: number; matches: number; failures: number; totalDurationMs: number }
    >;
    databaseByOperation: Record<
        string,
        { count: number; totalDurationMs: number; maxDurationMs: number }
    >;
};
const minuteBuckets: MinuteMetricBucket[] = [];
const minuteBucketsByTimestamp = new Map<number, MinuteMetricBucket>();

function getMinuteBucket(timestampMs: number): MinuteMetricBucket {
    const bucketTimestampMs =
        Math.floor(timestampMs / METRICS_BUCKET_INTERVAL_MS) * METRICS_BUCKET_INTERVAL_MS;
    const existingBucket = minuteBucketsByTimestamp.get(bucketTimestampMs);
    if (existingBucket) return existingBucket;
    let bucket: MinuteMetricBucket;
    {
        bucket = {
            timestamp: new Date(bucketTimestampMs).toISOString(),
            timestampMs: bucketTimestampMs,
            processedBlocks: 0,
            processedTransactions: 0,
            blockDurationMsTotal: 0,
            blockFilterDurationMsTotal: 0,
            databaseBatchWriteDurationMsTotal: 0,
            rpcRequests: 0,
            rpcFailures: 0,
            rpcRateLimitErrors: 0,
            rpcTimeoutErrors: 0,
            rpcConnectionErrors: 0,
            rpcProviderErrors: 0,
            rpcJsonRpcErrors: 0,
            rpcOtherErrors: 0,
            rpcRetryableFailures: 0,
            logicalRpcOperations: 0,
            successfulOperationAttempts: 0,
            rpcRetriedOperations: 0,
            rpcRetryAttempts: 0,
            rpcEndpointFailovers: 0,
            rpcOperationFailures: 0,
            rpcDurationMsTotal: 0,
            databaseQueries: 0,
            databaseReads: 0,
            databaseWrites: 0,
            databaseOther: 0,
            databaseFailures: 0,
            databaseDurationMsTotal: 0,
            filterEvaluations: 0,
            filterMatches: 0,
            filterFailures: 0,
            predicateDurationMsTotal: 0,
            lagBlocksSum: 0,
            lagSamples: 0,
            latestLagBlocks: null,
            processingBatches: 0,
            batchDurationMsTotal: 0,
            rpcMethods: {},
            filtersById: {},
            databaseByOperation: {},
        };
        minuteBuckets.push(bucket);
        minuteBuckets.sort((left, right) => left.timestampMs - right.timestampMs);
        minuteBucketsByTimestamp.set(bucketTimestampMs, bucket);
    }
    while (
        minuteBuckets.length > 0 &&
        (minuteBuckets.length > METRICS_MAX_BUCKETS ||
            timestampMs - minuteBuckets[0].timestampMs > METRICS_RETENTION_MS)
    ) {
        const removedBucket = minuteBuckets.shift();
        if (removedBucket) minuteBucketsByTimestamp.delete(removedBucket.timestampMs);
    }
    return bucket;
}

function recordMinuteLag(timestampMs: number, lagBlocks: number | null): void {
    if (lagBlocks === null) return;
    const bucket = getMinuteBucket(timestampMs);
    bucket.lagBlocksSum += lagBlocks;
    bucket.lagSamples += 1;
    bucket.latestLagBlocks = lagBlocks;
}
const endpointTotals = new Map<
    number,
    {
        attempts: number;
        successes: number;
        failures: number;
        retryableFailures: number;
        durationMs: number;
        lastFailureAt: string | null;
    }
>();
const rpcOperationTotals = {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    retriedOperations: 0,
    totalRetryAttempts: 0,
    endpointFailovers: 0,
    totalSuccessfulAttempts: 0,
};
const rpcTotals = {
    totalRequests: 0,
    successes: 0,
    failures: 0,
    retryableFailures: 0,
    rateLimitErrors: 0,
    timeoutErrors: 0,
    connectionErrors: 0,
    serverErrors: 0,
    providerErrors: 0,
    jsonRpcErrors: 0,
    otherErrors: 0,
    totalDurationMs: 0,
    lastErrorAt: null as string | null,
};
let latestFinalizedBlock: number | null = null;
let latestFinalizedAt: string | null = null;
let finalizedRegression = false;
let lastProcessedBlock: number | null = null;
let lastProcessedAt: string | null = null;
let rpcAvailable: boolean | null = null;
let scannerRunning = false;
let scannerPaused = false;
let activeFiltersCount = 0;
let maxBlocksPerCatchup = 0;
let maxParallelBlocks = 1;
let parallelProcessingLagBlocks = 0;
let catchUpActive = false;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let totalProcessedBlocks = 0;
let totalProcessedTransactions = 0;
let totalNativeTransfersSeen = 0;
let totalNativeMatches = 0;
let totalErc20TransferLogsSeen = 0;
let totalErc20Matches = 0;
let totalErc20FailedAttemptsSeen = 0;
let totalErc20FailedAttemptsMatched = 0;
let totalFetchDurationMs = 0;
let totalGetBlockDurationMs = 0;
let totalGetBlockReceiptsDurationMs = 0;
let totalFilterMatchingDurationMs = 0;
let totalBlockDurationMs = 0;
let totalDatabaseWriteDurationMs = 0;
const databaseMetrics = {
    writes: 0,
    failures: 0,
    totalWriteDurationMs: 0,
    lastErrorAt: null as string | null,
    lastError: null as string | null,
};
const filterMetrics = {
    evaluations: 0,
    matches: 0,
    failures: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    byFilter: {} as Record<
        string,
        { evaluations: number; matches: number; failures: number; totalDurationMs: number }
    >,
};
const databaseQueryTotals = {
    queries: 0,
    reads: 0,
    writes: 0,
    other: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastQueryAt: null as string | null,
    byOperation: {} as Record<
        string,
        { count: number; totalDurationMs: number; maxDurationMs: number }
    >,
};
let recoveryMetrics: Record<string, number> = {
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

function publish(): void {
    if (publishTimer) return;
    publishTimer = setTimeout(
        () => {
            publishTimer = undefined;
            try {
                const currentMetrics = calculateCurrentMetrics();
                getDynamicConfigService().publishMetrics(currentMetrics);
                const current = currentMetrics;
                getDynamicConfigService().updateScannerStatus({
                    scannerRunning: current.scanner.running,
                    paused: current.scanner.paused,
                    processUptimeSeconds: current.scanner.uptimeSeconds,
                    activeFiltersCount: current.scanner.activeFiltersCount,
                    latestFinalizedBlock: current.chain.latestFinalizedBlock,
                    latestFinalizedAt: current.chain.latestFinalizedAt,
                    lastProcessedBlock: current.chain.lastProcessedBlock,
                    lagBlocks: current.chain.lagBlocks,
                    finalizedRegression: current.chain.finalizedRegression,
                    finalizedRegressionMessage: current.chain.finalizedRegressionMessage,
                    rpcAvailable: current.chain.rpcAvailable ?? false,
                    rpcMetrics: current.rpc.endpoints,
                    recoveryMetrics: current.recovery,
                    processingMetrics: getBlockProcessingMetrics(),
                });
            } catch (error) {
                console.error(
                    `[Metrics] Failed to publish current metrics; scanner processing will continue: ${String(error)}`,
                );
            }
        },
        Number(getDynamicConfigService().getDynamicSettings().publishIntervalMs) ||
            METRICS_PUBLISH_INTERVAL_MS,
    );
    publishTimer.unref?.();
}

function trimSamples(now: number): void {
    while (
        blockSamplesStartIndex < blockSamples.length &&
        (blockSamples.length - blockSamplesStartIndex > METRICS_SAMPLE_LIMITS.blocks ||
            now - blockSamples[blockSamplesStartIndex].timestampMs > METRICS_RETENTION_MS)
    )
        blockSamplesStartIndex += 1;
    const previousRpcEventsStartIndex = rpcEventsStartIndex;
    while (
        rpcEventsStartIndex < rpcEvents.length &&
        (rpcEvents.length - rpcEventsStartIndex > METRICS_SAMPLE_LIMITS.rpcEvents ||
            now - rpcEvents[rpcEventsStartIndex].timestampMs > METRICS_RETENTION_MS)
    ) {
        rpcEventsStartIndex += 1;
    }
    if (rpcEventsStartIndex !== previousRpcEventsStartIndex) rpcSummaryCache = null;
    if (
        rpcEventsStartIndex >= METRICS_RPC_EVENT_COMPACTION_THRESHOLD &&
        rpcEventsStartIndex * 2 >= rpcEvents.length
    ) {
        rpcEvents.splice(0, rpcEventsStartIndex);
        rpcEventsStartIndex = 0;
    }
    while (
        catchUpSessions.length > 0 &&
        (catchUpSessions.length > METRICS_SAMPLE_LIMITS.catchUpSessions ||
            now - catchUpSessions[0].startedAtMs > METRICS_RETENTION_MS)
    )
        catchUpSessions.shift();
    while (
        batchSamples.length > 0 &&
        (batchSamples.length > METRICS_SAMPLE_LIMITS.batches ||
            now - batchSamples[0].timestampMs > METRICS_RETENTION_MS)
    )
        batchSamples.shift();
    while (
        finalizedSamples.length > 0 &&
        now - finalizedSamples[0].timestampMs > METRICS_RETENTION_MS
    )
        finalizedSamples.shift();
    while (
        lagSamplesStartIndex < lagSamples.length &&
        (lagSamples.length - lagSamplesStartIndex > METRICS_SAMPLE_LIMITS.lag ||
            now - lagSamples[lagSamplesStartIndex].timestampMs > METRICS_RETENTION_MS)
    )
        lagSamplesStartIndex += 1;
    if (
        blockSamplesStartIndex >= METRICS_SAMPLE_COMPACTION_THRESHOLD &&
        blockSamplesStartIndex * 2 >= blockSamples.length
    ) {
        blockSamples.splice(0, blockSamplesStartIndex);
        blockSamplesStartIndex = 0;
    }
    if (
        lagSamplesStartIndex >= METRICS_SAMPLE_COMPACTION_THRESHOLD &&
        lagSamplesStartIndex * 2 >= lagSamples.length
    ) {
        lagSamples.splice(0, lagSamplesStartIndex);
        lagSamplesStartIndex = 0;
    }
    while (
        minuteBuckets.length > 0 &&
        (minuteBuckets.length > METRICS_MAX_BUCKETS ||
            now - minuteBuckets[0].timestampMs > METRICS_RETENTION_MS)
    ) {
        const removedBucket = minuteBuckets.shift();
        if (removedBucket) minuteBucketsByTimestamp.delete(removedBucket.timestampMs);
    }
}

type RpcSummary = {
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    latencyP99Ms: number | null;
    methods: Array<{
        method: string;
        requests: number;
        successes: number;
        failures: number;
        totalDurationMs: number;
    }>;
    recentErrors: Array<Record<string, unknown>>;
};

let rpcSummaryCache: RpcSummary | null = null;
let rpcSummaryCalculatedAt = 0;

function getRpcSummary(now: number): RpcSummary {
    if (
        rpcSummaryCache &&
        now - rpcSummaryCalculatedAt <
            (Number(getDynamicConfigService().getDynamicSettings().analyticsRefreshMs) ||
                METRICS_ANALYTICS_REFRESH_INTERVAL_MS)
    ) {
        return rpcSummaryCache;
    }

    const latencySamples: number[] = [];
    const methodTotals = new Map<
        string,
        { requests: number; successes: number; failures: number; totalDurationMs: number }
    >();
    for (let index = rpcEventsStartIndex; index < rpcEvents.length; index += 1) {
        const event = rpcEvents[index];
        const durationMs = Number(event.durationMs);
        if (Number.isFinite(durationMs)) latencySamples.push(durationMs);

        const method = String(event.method);
        const value = methodTotals.get(method) ?? {
            requests: 0,
            successes: 0,
            failures: 0,
            totalDurationMs: 0,
        };
        value.requests += 1;
        value.totalDurationMs += durationMs;
        if (event.outcome === 'success') value.successes += 1;
        else value.failures += 1;
        methodTotals.set(method, value);
    }
    latencySamples.sort((left, right) => left - right);
    const percentile = (ratio: number): number | null =>
        latencySamples.length
            ? latencySamples[
                  Math.min(latencySamples.length - 1, Math.ceil(latencySamples.length * ratio) - 1)
              ]
            : null;

    const recentErrors: Array<Record<string, unknown>> = [];
    for (let index = rpcEvents.length - 1; index >= rpcEventsStartIndex; index -= 1) {
        const event = rpcEvents[index];
        if (event.outcome !== 'failure') continue;
        const { timestampMs: _timestampMs, ...error } = event;
        recentErrors.push(error);
        if (recentErrors.length >= METRICS_SAMPLE_LIMITS.recentRpcErrors) break;
    }
    recentErrors.reverse();

    rpcSummaryCache = {
        latencyP50Ms: percentile(0.5),
        latencyP95Ms: percentile(0.95),
        latencyP99Ms: percentile(0.99),
        methods: Array.from(methodTotals.entries()).map(([method, value]) => ({
            method,
            ...value,
        })),
        recentErrors,
    };
    rpcSummaryCalculatedAt = now;
    return rpcSummaryCache;
}

type RecentBlockSummary = {
    count: number;
    totals: {
        transactionCount: number;
        blockDurationMs: number;
        fetchDurationMs: number;
        getBlockDurationMs: number;
        getBlockReceiptsDurationMs: number;
        filterMatchingDurationMs: number;
        databaseWriteDurationMs: number;
    };
    recentBlocks: Array<Record<string, unknown>>;
};

function getRecentBlockSummary(now: number): RecentBlockSummary {
    const summary: RecentBlockSummary = {
        count: 0,
        totals: {
            transactionCount: 0,
            blockDurationMs: 0,
            fetchDurationMs: 0,
            getBlockDurationMs: 0,
            getBlockReceiptsDurationMs: 0,
            filterMatchingDurationMs: 0,
            databaseWriteDurationMs: 0,
        },
        recentBlocks: [],
    };

    for (let index = blockSamplesStartIndex; index < blockSamples.length; index += 1) {
        const sample = blockSamples[index];
        if (now - sample.timestampMs > METRICS_RECENT_BLOCK_WINDOW_MS) continue;

        summary.count += 1;
        summary.totals.transactionCount += Number(sample.transactionCount ?? 0);
        summary.totals.blockDurationMs += Number(sample.blockDurationMs ?? 0);
        summary.totals.fetchDurationMs += Number(sample.fetchDurationMs ?? 0);
        summary.totals.getBlockDurationMs += Number(sample.getBlockDurationMs ?? 0);
        summary.totals.getBlockReceiptsDurationMs += Number(sample.getBlockReceiptsDurationMs ?? 0);
        summary.totals.filterMatchingDurationMs += Number(sample.filterMatchingDurationMs ?? 0);
        summary.totals.databaseWriteDurationMs += Number(sample.databaseWriteDurationMs ?? 0);

        const { timestampMs: _timestampMs, ...recentBlock } = sample;
        if (summary.recentBlocks.length === 30) summary.recentBlocks.shift();
        summary.recentBlocks.push(recentBlock);
    }

    return summary;
}

function calculateCurrentMetrics() {
    const now = Date.now();
    trimSamples(now);
    const rpcSummary = getRpcSummary(now);
    const cpuUsage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    const cpuElapsedMs = Math.max(1, now - lastCpuSampleAt);
    lastCpuSampleAt = now;
    const cpuPercent = Number(
        (((cpuUsage.user + cpuUsage.system) / 1000 / cpuElapsedMs) * 100).toFixed(2),
    );
    const eventLoopUtilization = performance.eventLoopUtilization(lastEventLoopUtilization);
    lastEventLoopUtilization = performance.eventLoopUtilization();
    const memoryUsage = process.memoryUsage();
    const recent = getRecentBlockSummary(now);
    const recentWindowSeconds = Math.max(
        1,
        Math.min(METRICS_RECENT_RATE_WINDOW_MS / 1000, (now - startedAtMs) / 1000),
    );
    const average = (key: keyof RecentBlockSummary['totals']) =>
        recent.count ? Number((recent.totals[key] / recent.count).toFixed(1)) : null;
    const totalTransactions = totalProcessedTransactions;
    const lagBlocks =
        !finalizedRegression && latestFinalizedBlock !== null && lastProcessedBlock !== null
            ? Math.max(0, latestFinalizedBlock - lastProcessedBlock)
            : null;
    const recentTransactions = recent.totals.transactionCount;
    const recentFinalized = finalizedSamples.filter(
        (sample) => now - sample.timestampMs <= METRICS_FINALIZED_SAMPLE_WINDOW_MS,
    );
    const finalizedElapsedMs =
        recentFinalized.length > 1
            ? recentFinalized[recentFinalized.length - 1].timestampMs -
              recentFinalized[0].timestampMs
            : 0;
    const chainBlocksPerSecond =
        finalizedElapsedMs > 0
            ? Number(
                  (
                      ((recentFinalized[recentFinalized.length - 1].blockNumber -
                          recentFinalized[0].blockNumber) *
                          1000) /
                      finalizedElapsedMs
                  ).toFixed(2),
              )
            : null;
    const blocksPerSecondLastMinute = Number((recent.count / recentWindowSeconds).toFixed(2));
    const activeCatchUpSession = catchUpSessions[catchUpSessions.length - 1];
    const activeCatchUpElapsedMs =
        activeCatchUpSession?.status === 'running' ? now - activeCatchUpSession.startedAtMs : 0;
    const lagReductionBlocksPerSecond =
        activeCatchUpSession?.status === 'running' &&
        lagBlocks !== null &&
        activeCatchUpElapsedMs >= METRICS_CATCH_UP_ETA_MIN_DURATION_MS
            ? Number(
                  (
                      ((Number(activeCatchUpSession.initialLagBlocks) - lagBlocks) * 1000) /
                      activeCatchUpElapsedMs
                  ).toFixed(2),
              )
            : null;
    const estimatedCatchUpSeconds =
        lagBlocks !== null &&
        lagBlocks > 0 &&
        lagReductionBlocksPerSecond !== null &&
        lagReductionBlocksPerSecond > 0
            ? Number((lagBlocks / lagReductionBlocksPerSecond).toFixed(1))
            : null;
    const endpoints = Array.from(endpointTotals.entries()).map(([index, value]) => ({
        index,
        attempts: value.attempts,
        successes: value.successes,
        failures: value.failures,
        retryableFailures: value.retryableFailures,
        totalDurationMs: value.durationMs,
        lastFailureAt: value.lastFailureAt,
        averageLatencyMs: value.attempts
            ? Number((value.durationMs / value.attempts).toFixed(1))
            : null,
    }));
    return {
        startedAt,
        updatedAt: new Date(now).toISOString(),
        process: {
            memoryRssMb: Number((memoryUsage.rss / 1048576).toFixed(1)),
            memoryHeapUsedMb: Number((memoryUsage.heapUsed / 1048576).toFixed(1)),
            memoryHeapTotalMb: Number((memoryUsage.heapTotal / 1048576).toFixed(1)),
            memoryExternalMb: Number((memoryUsage.external / 1048576).toFixed(1)),
            cpuPercent,
            eventLoopUtilizationPercent: Number(
                (eventLoopUtilization.utilization * 100).toFixed(2),
            ),
        },
        scanner: {
            running: scannerRunning,
            paused: scannerPaused,
            uptimeSeconds: Math.floor(process.uptime()),
            activeFiltersCount,
            maxBlocksPerCatchup,
            maxParallelBlocks,
            parallelProcessingLagBlocks,
        },
        chain: {
            latestFinalizedBlock,
            latestFinalizedAt,
            finalizedCadence: (() => {
                const samples = finalizedSamples.filter(
                    (sample) => now - sample.timestampMs <= METRICS_RETENTION_MS,
                );
                const intervals = samples
                    .slice(1)
                    .map((sample, index) => ({
                        intervalMs: sample.timestampMs - samples[index].timestampMs,
                        blocksAdvanced: sample.blockNumber - samples[index].blockNumber,
                    }))
                    .filter((sample) => sample.intervalMs > 0 && sample.blocksAdvanced > 0);
                const summarize = (values: number[]) =>
                    values.length
                        ? {
                              min: Number(Math.min(...values).toFixed(1)),
                              average: Number(
                                  (
                                      values.reduce((total, value) => total + value, 0) /
                                      values.length
                                  ).toFixed(1),
                              ),
                              max: Number(Math.max(...values).toFixed(1)),
                          }
                        : { min: null, average: null, max: null };
                const lastInterval = intervals[intervals.length - 1];
                return {
                    // A detection is recorded only when the observed finalized height advances.
                    // Intervals measure wall-clock time between those detections, regardless of
                    // how many finalized blocks arrived in each update.
                    detections: samples.length,
                    observedIntervals: intervals.length,
                    detectionIntervalMs: summarize(intervals.map((sample) => sample.intervalMs)),
                    blocksPerUpdate: summarize(intervals.map((sample) => sample.blocksAdvanced)),
                    lastIntervalMs: lastInterval?.intervalMs ?? null,
                    lastBlocksAdvanced: lastInterval?.blocksAdvanced ?? null,
                };
            })(),
            lastProcessedBlock,
            lastProcessedAt,
            lagBlocks,
            rpcAvailable,
            finalizedRegression,
            finalizedRegressionMessage:
                finalizedRegression && latestFinalizedBlock !== null && lastProcessedBlock !== null
                    ? `RPC returned finalized block ${latestFinalizedBlock}, below checkpoint ${lastProcessedBlock}. Scanner processing is paused and will retry in ${FINALIZED_REGRESSION_WAIT_MS / 1000}s. If this persists, manual intervention and investigation may be required.`
                    : null,
        },
        processing: {
            processedBlocks: totalProcessedBlocks,
            processedTransactions: totalTransactions,
            totalNativeTransfersSeen,
            totalNativeMatches,
            totalErc20TransferLogsSeen,
            totalErc20Matches,
            totalErc20FailedAttemptsSeen,
            totalErc20FailedAttemptsMatched,
            totalFetchDurationMs,
            totalGetBlockDurationMs,
            totalGetBlockReceiptsDurationMs,
            totalFilterMatchingDurationMs,
            totalBlockDurationMs,
            totalDatabaseWriteDurationMs,
            blocksPerSecondLastMinute,
            transactionsPerSecondLastMinute: Number(
                (recentTransactions / recentWindowSeconds).toFixed(2),
            ),
            averageTransactionsPerBlock: totalProcessedBlocks
                ? Number((totalTransactions / totalProcessedBlocks).toFixed(1))
                : 0,
            averageBlockDurationMs: average('blockDurationMs'),
            averageFetchDurationMs: average('fetchDurationMs'),
            averageGetBlockDurationMs: average('getBlockDurationMs'),
            averageGetBlockReceiptsDurationMs: average('getBlockReceiptsDurationMs'),
            averageFilterMatchingDurationMs: average('filterMatchingDurationMs'),
            averageDatabaseWriteDurationMs: average('databaseWriteDurationMs'),
            lastBlockTransactionCount:
                blockSamples.length > blockSamplesStartIndex
                    ? Number(blockSamples[blockSamples.length - 1].transactionCount)
                    : null,
        },
        rpc: {
            ...rpcTotals,
            averageLatencyMs: rpcTotals.totalRequests
                ? Number((rpcTotals.totalDurationMs / rpcTotals.totalRequests).toFixed(1))
                : null,
            latencyP50Ms: rpcSummary.latencyP50Ms,
            latencyP95Ms: rpcSummary.latencyP95Ms,
            latencyP99Ms: rpcSummary.latencyP99Ms,
            methods: rpcSummary.methods,
            endpoints,
            operations: {
                ...rpcOperationTotals,
                averageAttemptsPerSuccessfulOperation: rpcOperationTotals.successfulOperations
                    ? Number(
                          (
                              rpcOperationTotals.totalSuccessfulAttempts /
                              rpcOperationTotals.successfulOperations
                          ).toFixed(2),
                      )
                    : null,
                retryRate: rpcOperationTotals.totalOperations
                    ? Number(
                          (
                              (rpcOperationTotals.retriedOperations /
                                  rpcOperationTotals.totalOperations) *
                              100
                          ).toFixed(2),
                      )
                    : 0,
            },
        },
        catchUp: {
            active: catchUpActive,
            currentLagBlocks: lagBlocks,
            chainBlocksPerSecond,
            lagReductionBlocksPerSecond,
            estimatedRemainingSeconds: estimatedCatchUpSeconds,
            sessions: catchUpSessions.map(({ startedAtMs, ...session }) => {
                if (session.status !== 'running') return session;
                const durationMs = Math.max(0, now - startedAtMs);
                const processedBlocks = Number(session.processedBlocks ?? 0);
                const processedTransactions = Number(session.processedTransactions ?? 0);
                const finalLagBlocks = lagBlocks ?? Number(session.initialLagBlocks);
                const lagReductionBlocks = Number(session.initialLagBlocks) - finalLagBlocks;
                return {
                    ...session,
                    durationMs,
                    blocksPerSecond:
                        durationMs > 0
                            ? Number(((processedBlocks * 1000) / durationMs).toFixed(2))
                            : 0,
                    transactionsPerSecond:
                        durationMs > 0
                            ? Number(((processedTransactions * 1000) / durationMs).toFixed(2))
                            : 0,
                    finalLagBlocks,
                    lagReductionBlocks,
                    lagReductionPerSecond:
                        durationMs > 0
                            ? Number(((lagReductionBlocks * 1000) / durationMs).toFixed(2))
                            : 0,
                };
            }),
        },
        filters: {
            ...filterMetrics,
            averageDurationMs: filterMetrics.evaluations
                ? Number((filterMetrics.totalDurationMs / filterMetrics.evaluations).toFixed(2))
                : null,
        },
        database: {
            ...databaseMetrics,
            averageWriteDurationMs: databaseMetrics.writes
                ? Number((databaseMetrics.totalWriteDurationMs / databaseMetrics.writes).toFixed(1))
                : null,
            ...databaseQueryTotals,
            averageQueryDurationMs: databaseQueryTotals.queries
                ? Number(
                      (databaseQueryTotals.totalDurationMs / databaseQueryTotals.queries).toFixed(
                          1,
                      ),
                  )
                : null,
        },
        recovery: { ...recoveryMetrics },
        recentRpcErrors: rpcSummary.recentErrors,
        recentBlocks: recent.recentBlocks,
    };
}

function completeCatchUp(status: 'completed' | 'interrupted'): void {
    const session = catchUpSessions[catchUpSessions.length - 1];
    if (!session || session.status !== 'running') return;
    const now = Date.now();
    const durationMs = now - session.startedAtMs;
    session.completedAt = new Date(now).toISOString();
    session.endBlock = lastProcessedBlock;
    session.durationMs = durationMs;
    session.blocksPerSecond =
        durationMs > 0
            ? Number(((Number(session.processedBlocks) * 1000) / durationMs).toFixed(2))
            : 0;
    const finalLagBlocks =
        latestFinalizedBlock !== null && lastProcessedBlock !== null
            ? Math.max(0, latestFinalizedBlock - lastProcessedBlock)
            : Number(session.initialLagBlocks);
    const lagReductionBlocks = Number(session.initialLagBlocks) - finalLagBlocks;
    session.finalLagBlocks = finalLagBlocks;
    session.lagReductionBlocks = lagReductionBlocks;
    session.lagReductionPerSecond =
        durationMs > 0 ? Number(((lagReductionBlocks * 1000) / durationMs).toFixed(2)) : 0;
    session.transactionsPerSecond =
        durationMs > 0
            ? Number(((Number(session.processedTransactions) * 1000) / durationMs).toFixed(2))
            : 0;
    session.status = status;
    catchUpActive = false;
}

export function recordFinalizedBlock(blockNumber: number): void {
    finalizedRegression = lastProcessedBlock !== null && blockNumber < lastProcessedBlock;
    const observedAtMs = Date.now();
    const previousFinalizedSample = finalizedSamples[finalizedSamples.length - 1];
    const headChanged = latestFinalizedBlock === null || blockNumber !== latestFinalizedBlock;
    latestFinalizedBlock = blockNumber;
    if (
        finalizedRegression ||
        (previousFinalizedSample && blockNumber < previousFinalizedSample.blockNumber)
    ) {
        finalizedSamples.length = 0;
        finalizedSamples.push({ timestampMs: observedAtMs, blockNumber });
    } else if (!previousFinalizedSample || blockNumber > previousFinalizedSample.blockNumber) {
        // Keep only actual finalized-head advances. Repeated 4s polls of the same
        // height must not distort the observed update cadence.
        finalizedSamples.push({ timestampMs: observedAtMs, blockNumber });
    }
    // This timestamp means when the observed finalized head last changed,
    // not when the same head was polled again.
    if (headChanged) latestFinalizedAt = new Date(observedAtMs).toISOString();
    trimSamples(observedAtMs);
    rpcAvailable = true;
    const lag =
        finalizedRegression || lastProcessedBlock === null
            ? null
            : Math.max(0, blockNumber - lastProcessedBlock);
    const finalizedTimestampMs = Date.now();
    lagSamples.push({
        timestamp: latestFinalizedAt,
        timestampMs: finalizedTimestampMs,
        latestFinalizedBlock: blockNumber,
        lastProcessedBlock,
        lagBlocks: lag,
    });
    recordMinuteLag(finalizedTimestampMs, lag);
    if (
        lag !== null &&
        lag >
            (Number(getDynamicConfigService().getDynamicSettings().parallelProcessingLagBlocks) ||
                SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS) &&
        !catchUpActive
    ) {
        const now = Date.now();
        catchUpSessions.push({
            startedAt: new Date(now).toISOString(),
            startedAtMs: now,
            completedAt: null,
            startBlock: (lastProcessedBlock ?? blockNumber) + 1,
            endBlock: null,
            initialLagBlocks: lag,
            processedBlocks: 0,
            processedTransactions: 0,
            durationMs: null,
            blocksPerSecond: null,
            transactionsPerSecond: null,
            status: 'running',
        });
        catchUpActive = true;
    } else if (lag === 0 && catchUpActive) completeCatchUp('completed');
    publish();
}

export function recordFinalizedBlockFailure(): void {
    rpcAvailable = false;
    publish();
}

export function recordProcessedBlock(input: BlockInput): void {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    blockSamples.push({ ...input, timestamp, timestampMs: now });
    totalProcessedBlocks += 1;
    totalProcessedTransactions += input.transactionCount;
    totalNativeTransfersSeen += input.nativeTransfersSeen;
    totalNativeMatches += input.nativeMatches;
    totalErc20TransferLogsSeen += input.erc20TransferLogsSeen;
    totalErc20Matches += input.erc20Matches;
    totalErc20FailedAttemptsSeen += input.erc20FailedAttemptsSeen;
    totalErc20FailedAttemptsMatched += input.erc20FailedAttemptsMatched;
    totalFetchDurationMs += input.fetchDurationMs;
    totalGetBlockDurationMs += input.getBlockDurationMs;
    totalGetBlockReceiptsDurationMs += input.getBlockReceiptsDurationMs;
    totalFilterMatchingDurationMs += input.filterMatchingDurationMs;
    totalBlockDurationMs += input.blockDurationMs;
    totalDatabaseWriteDurationMs += input.databaseWriteDurationMs;
    lastProcessedBlock = input.blockNumber;
    lastProcessedAt = timestamp;
    finalizedRegression =
        latestFinalizedBlock !== null && latestFinalizedBlock < lastProcessedBlock;
    const currentLag =
        finalizedRegression || latestFinalizedBlock === null
            ? null
            : Math.max(0, latestFinalizedBlock - lastProcessedBlock);
    lagSamples.push({
        timestamp,
        timestampMs: now,
        latestFinalizedBlock,
        lastProcessedBlock,
        lagBlocks: currentLag,
    });
    const minuteBucket = getMinuteBucket(now);
    minuteBucket.processedBlocks += 1;
    minuteBucket.processedTransactions += input.transactionCount;
    minuteBucket.blockDurationMsTotal += input.blockDurationMs;
    minuteBucket.blockFilterDurationMsTotal += input.filterMatchingDurationMs;
    minuteBucket.databaseBatchWriteDurationMsTotal += input.databaseWriteDurationMs;
    recordMinuteLag(now, currentLag);
    const session = catchUpSessions[catchUpSessions.length - 1];
    if (session?.status === 'running') {
        session.processedBlocks = Number(session.processedBlocks) + 1;
        session.processedTransactions =
            Number(session.processedTransactions) + input.transactionCount;
    }
    if (latestFinalizedBlock !== null && input.blockNumber >= latestFinalizedBlock && catchUpActive)
        completeCatchUp('completed');
    trimSamples(now);
    publish();
}

export function recordRpcRequest(input: RpcInput): void {
    const now = Date.now();
    const message = input.message ?? '';
    const classification = classifyRpcError(message);
    const failureKind = input.errorCategory ?? classification.category;
    if (input.outcome === 'failure') {
        rpcTotals.failures += 1;
        if (input.retryable ?? classification.retryable) rpcTotals.retryableFailures += 1;
        rpcTotals.lastErrorAt = new Date(now).toISOString();
        if (failureKind === 'rateLimit') rpcTotals.rateLimitErrors += 1;
        else if (failureKind === 'timeout') rpcTotals.timeoutErrors += 1;
        else if (failureKind === 'network') rpcTotals.connectionErrors += 1;
        else if (failureKind === 'provider') {
            rpcTotals.serverErrors += 1;
            rpcTotals.providerErrors += 1;
        } else if (failureKind === 'rpc') rpcTotals.jsonRpcErrors += 1;
        else rpcTotals.otherErrors += 1;
    } else rpcTotals.successes += 1;
    rpcTotals.totalRequests += 1;
    rpcTotals.totalDurationMs += input.durationMs;
    const rpcBucket = getMinuteBucket(now);
    rpcBucket.rpcRequests += 1;
    rpcBucket.rpcDurationMsTotal += input.durationMs;
    if (input.outcome === 'failure') rpcBucket.rpcFailures += 1;
    const methodMetrics = rpcBucket.rpcMethods[input.method] ?? {
        requests: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
    };
    methodMetrics.requests += 1;
    methodMetrics.totalDurationMs += input.durationMs;
    if (input.outcome === 'success') methodMetrics.successes += 1;
    else methodMetrics.failures += 1;
    rpcBucket.rpcMethods[input.method] = methodMetrics;
    if (input.outcome === 'failure') {
        if (failureKind === 'rateLimit') rpcBucket.rpcRateLimitErrors += 1;
        else if (failureKind === 'timeout') rpcBucket.rpcTimeoutErrors += 1;
        else if (failureKind === 'network') rpcBucket.rpcConnectionErrors += 1;
        else if (failureKind === 'provider') rpcBucket.rpcProviderErrors += 1;
        else if (failureKind === 'rpc') rpcBucket.rpcJsonRpcErrors += 1;
        else rpcBucket.rpcOtherErrors += 1;
        if (input.retryable ?? classification.retryable) rpcBucket.rpcRetryableFailures += 1;
    }
    const endpoint = endpointTotals.get(input.endpointIndex) ?? {
        attempts: 0,
        successes: 0,
        failures: 0,
        retryableFailures: 0,
        durationMs: 0,
        lastFailureAt: null as string | null,
    };
    endpoint.attempts += 1;
    endpoint.durationMs += input.durationMs;
    if (input.outcome === 'success') endpoint.successes += 1;
    else {
        endpoint.failures += 1;
        if (input.retryable ?? classification.retryable) endpoint.retryableFailures += 1;
        endpoint.lastFailureAt = new Date(now).toISOString();
    }
    endpointTotals.set(input.endpointIndex, endpoint);
    rpcEvents.push({
        timestamp: new Date(now).toISOString(),
        timestampMs: now,
        method: input.method,
        endpointIndex: input.endpointIndex,
        durationMs: input.durationMs,
        outcome: input.outcome,
        failureKind,
        httpStatus: input.httpStatus ?? classification.httpStatus,
        rpcCode: input.rpcCode ?? classification.rpcCode,
        message: input.outcome === 'failure' ? message.slice(0, 500) : null,
    });
    trimSamples(now);
    publish();
}

export function updateScannerContext(input: {
    running?: boolean;
    paused?: boolean;
    activeFiltersCount?: number;
    lastProcessedBlock?: number | null;
    recovery?: Record<string, number>;
    maxBlocksPerCatchup?: number;
    maxParallelBlocks?: number;
    parallelProcessingLagBlocks?: number;
}): void {
    if (input.running !== undefined) scannerRunning = input.running;
    if (input.paused !== undefined) scannerPaused = input.paused;
    if (input.activeFiltersCount !== undefined) activeFiltersCount = input.activeFiltersCount;
    if (input.lastProcessedBlock !== undefined) lastProcessedBlock = input.lastProcessedBlock;
    if (input.maxBlocksPerCatchup !== undefined) maxBlocksPerCatchup = input.maxBlocksPerCatchup;
    if (input.maxParallelBlocks !== undefined) maxParallelBlocks = input.maxParallelBlocks;
    if (input.parallelProcessingLagBlocks !== undefined)
        parallelProcessingLagBlocks = input.parallelProcessingLagBlocks;
    if (input.recovery) recoveryMetrics = { ...input.recovery };
    publish();
}

export function getBlockProcessingMetrics() {
    const now = Date.now();
    const recent = getRecentBlockSummary(now);
    const recentWindowSeconds = Math.max(
        1,
        Math.min(METRICS_RECENT_RATE_WINDOW_MS / 1000, (now - startedAtMs) / 1000),
    );
    const average = (key: keyof RecentBlockSummary['totals']) =>
        recent.count ? Number((recent.totals[key] / recent.count).toFixed(1)) : null;
    const last =
        blockSamples.length > blockSamplesStartIndex
            ? blockSamples[blockSamples.length - 1]
            : undefined;
    return {
        processedBlocks: totalProcessedBlocks,
        totalTransactions: totalProcessedTransactions,
        totalNativeTransfersSeen,
        totalNativeMatches,
        totalErc20TransferLogsSeen,
        totalErc20Matches,
        totalErc20FailedAttemptsSeen,
        totalErc20FailedAttemptsMatched,
        totalFetchDurationMs,
        totalGetBlockDurationMs,
        totalGetBlockReceiptsDurationMs,
        totalFilterMatchingDurationMs,
        totalBlockDurationMs,
        totalDatabaseWriteDurationMs,
        lastProcessedBlock,
        lastProcessedAt,
        lastBlockDurationMs: last ? Number(last.blockDurationMs) : null,
        blocksProcessedLastMinute: recent.count,
        blocksPerSecondLastMinute: Number((recent.count / recentWindowSeconds).toFixed(2)),
        averageBlockDurationLastMinuteMs: average('blockDurationMs'),
        averageFetchDurationLastMinuteMs: average('fetchDurationMs'),
        averageDatabaseWriteDurationLastMinuteMs: average('databaseWriteDurationMs'),
        recentBlocks: recent.recentBlocks.map((sample) => ({
            blockNumber: Number(sample.blockNumber),
            processedAt: String(sample.timestamp),
            blockDurationMs: Number(sample.blockDurationMs),
            fetchDurationMs: Number(sample.fetchDurationMs),
            filterMatchingDurationMs: Number(sample.filterMatchingDurationMs),
            databaseWriteDurationMs: Number(sample.databaseWriteDurationMs),
            nativeTransfersSeen: Number(sample.nativeTransfersSeen),
            nativeMatches: Number(sample.nativeMatches),
            erc20TransferLogsSeen: Number(sample.erc20TransferLogsSeen),
            erc20Matches: Number(sample.erc20Matches),
        })),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getCurrentMetrics(): Record<string, unknown> {
    const current = getDynamicConfigService().getCurrentMetrics();
    return isRecord(current) ? current : calculateCurrentMetrics();
}

export function recordProcessingBatch(input: {
    startBlock: number;
    endBlock: number;
    blocks: number;
    transactions: number;
    durationMs: number;
    databaseWriteDurationMs: number;
    fetchStageDurationMs: number;
    processingStageDurationMs: number;
    persistenceStageDurationMs: number;
    configuredMaxParallelBlocks: number;
    parallelProcessingLagBlocks: number;
    lagAtBatchStart: number;
    maxConcurrentFetches: number;
    maxConcurrentProcessing: number;
}): void {
    const now = Date.now();
    batchSamples.push({
        ...input,
        timestamp: new Date(now).toISOString(),
        timestampMs: now,
        blocksPerSecond:
            input.durationMs > 0
                ? Number(((input.blocks * 1000) / input.durationMs).toFixed(2))
                : 0,
        transactionsPerSecond:
            input.durationMs > 0
                ? Number(((input.transactions * 1000) / input.durationMs).toFixed(2))
                : 0,
    });
    databaseMetrics.writes += 1;
    databaseMetrics.totalWriteDurationMs += input.databaseWriteDurationMs;
    const bucket = getMinuteBucket(now);
    bucket.processingBatches += 1;
    bucket.batchDurationMsTotal += input.durationMs;
    trimSamples(now);
    publish();
}

export function recordDatabaseFailure(operation: string, message: string): void {
    databaseMetrics.failures += 1;
    databaseMetrics.lastErrorAt = new Date().toISOString();
    databaseMetrics.lastError = (operation + ': ' + message).slice(0, 500);
    getMinuteBucket(Date.now()).databaseFailures += 1;
    publish();
}

function buildScannerAnalytics(
    windowMs: number,
    windowLabel: string,
    current: ReturnType<typeof getCurrentMetrics>,
    sortedRpcDurations: Array<{ timestampMs: number; durationMs: number }>,
): ScannerAnalyticsResponse {
    const now = Date.now();
    const requestedWindowMs = Math.max(
        METRICS_MIN_ANALYTICS_WINDOW_MS,
        Math.min(windowMs, METRICS_RETENTION_MS),
    );
    const availableWindowMs = Math.max(0, Math.min(requestedWindowMs, now - startedAtMs));
    const since = now - availableWindowMs;
    const recentRpcErrors: Array<Record<string, unknown>> = [];
    for (let index = rpcEvents.length - 1; index >= rpcEventsStartIndex; index -= 1) {
        const event = rpcEvents[index];
        if (event.timestampMs < since) break;
        if (event.outcome !== 'failure') continue;
        const { timestampMs: _timestampMs, ...error } = event;
        recentRpcErrors.push(error);
        if (recentRpcErrors.length >= METRICS_ANALYTICS_RECENT_RPC_ERRORS) break;
    }
    recentRpcErrors.reverse();
    const selectedSessions = catchUpSessions.filter(
        (session) =>
            session.status === 'running' ||
            session.startedAtMs >= since ||
            (session.completedAt !== null && Date.parse(String(session.completedAt)) >= since),
    );
    const latestBatch: Array<Record<string, unknown>> = [];
    for (let index = batchSamples.length - 1; index >= 0; index -= 1) {
        const sample = batchSamples[index];
        if (sample.timestampMs < since) break;
        const { timestampMs: _timestampMs, ...batch } = sample;
        latestBatch.push(batch);
        break;
    }
    const selectedMinuteBuckets = minuteBuckets.filter(
        (bucket) => bucket.timestampMs + METRICS_BUCKET_INTERVAL_MS > since,
    );
    const selectedBatches = batchSamples.filter((sample) => sample.timestampMs >= since);
    const batchTotals = selectedBatches.reduce(
        (totals, sample) => {
            const blocks = Number(sample.blocks ?? 0);
            const batchSizeKey = String(blocks);
            totals.blocks += blocks;
            totals.transactions += Number(sample.transactions ?? 0);
            totals.activeDurationMs += Number(sample.durationMs ?? 0);
            totals.databaseWriteDurationMs += Number(sample.databaseWriteDurationMs ?? 0);
            totals.fetchStageDurationMs += Number(sample.fetchStageDurationMs ?? 0);
            totals.processingStageDurationMs += Number(sample.processingStageDurationMs ?? 0);
            totals.persistenceStageDurationMs += Number(sample.persistenceStageDurationMs ?? 0);
            totals.totalMaxConcurrentFetches += Number(sample.maxConcurrentFetches ?? 0);
            totals.totalMaxConcurrentProcessing += Number(sample.maxConcurrentProcessing ?? 0);
            totals.maxConcurrentFetches = Math.max(
                totals.maxConcurrentFetches,
                Number(sample.maxConcurrentFetches ?? 0),
            );
            totals.maxConcurrentProcessing = Math.max(
                totals.maxConcurrentProcessing,
                Number(sample.maxConcurrentProcessing ?? 0),
            );
            totals.minBlocksPerBatch = Math.min(totals.minBlocksPerBatch, blocks);
            totals.maxBlocksPerBatch = Math.max(totals.maxBlocksPerBatch, blocks);
            totals.batchSizeDistribution[batchSizeKey] =
                (totals.batchSizeDistribution[batchSizeKey] ?? 0) + 1;
            return totals;
        },
        {
            blocks: 0,
            transactions: 0,
            activeDurationMs: 0,
            databaseWriteDurationMs: 0,
            fetchStageDurationMs: 0,
            processingStageDurationMs: 0,
            persistenceStageDurationMs: 0,
            totalMaxConcurrentFetches: 0,
            totalMaxConcurrentProcessing: 0,
            maxConcurrentFetches: 0,
            maxConcurrentProcessing: 0,
            minBlocksPerBatch: Number.POSITIVE_INFINITY,
            maxBlocksPerBatch: 0,
            batchSizeDistribution: {} as Record<string, number>,
        },
    );
    const sumBucketMetric = (key: keyof MinuteMetricBucket): number =>
        selectedMinuteBuckets.reduce((total, bucket) => total + Number(bucket[key] ?? 0), 0);
    const windowSeconds = Math.max(1, availableWindowMs / 1000);
    const processedBlocks = sumBucketMetric('processedBlocks');
    const processedTransactions = sumBucketMetric('processedTransactions');
    const rpcRequests = sumBucketMetric('rpcRequests');
    const rpcFailures = sumBucketMetric('rpcFailures');
    const logicalRpcOperations = sumBucketMetric('logicalRpcOperations');
    const failedRpcOperations = sumBucketMetric('rpcOperationFailures');
    const successfulRpcOperations = Math.max(0, logicalRpcOperations - failedRpcOperations);
    const selectedRpcDurationCount = sortedRpcDurations.reduce(
        (count, sample) => count + (sample.timestampMs >= since ? 1 : 0),
        0,
    );
    const windowPercentile = (ratio: number): number | null => {
        if (!selectedRpcDurationCount) return null;
        const targetIndex = Math.min(
            selectedRpcDurationCount - 1,
            Math.ceil(selectedRpcDurationCount * ratio) - 1,
        );
        let selectedIndex = 0;
        for (const sample of sortedRpcDurations) {
            if (sample.timestampMs < since) continue;
            if (selectedIndex === targetIndex) return sample.durationMs;
            selectedIndex += 1;
        }
        return null;
    };
    const windowRpcMethods: Record<
        string,
        { requests: number; successes: number; failures: number; totalDurationMs: number }
    > = {};
    const windowFiltersById: Record<
        string,
        { evaluations: number; matches: number; failures: number; totalDurationMs: number }
    > = {};
    const windowDatabaseByOperation: Record<
        string,
        { count: number; totalDurationMs: number; maxDurationMs: number }
    > = {};
    for (const bucket of selectedMinuteBuckets) {
        for (const [method, metric] of Object.entries(bucket.rpcMethods)) {
            const total = windowRpcMethods[method] ?? {
                requests: 0,
                successes: 0,
                failures: 0,
                totalDurationMs: 0,
            };
            total.requests += metric.requests;
            total.successes += metric.successes;
            total.failures += metric.failures;
            total.totalDurationMs += metric.totalDurationMs;
            windowRpcMethods[method] = total;
        }
        for (const [filterId, metric] of Object.entries(bucket.filtersById)) {
            const total = windowFiltersById[filterId] ?? {
                evaluations: 0,
                matches: 0,
                failures: 0,
                totalDurationMs: 0,
            };
            total.evaluations += metric.evaluations;
            total.matches += metric.matches;
            total.failures += metric.failures;
            total.totalDurationMs += metric.totalDurationMs;
            windowFiltersById[filterId] = total;
        }
        for (const [operation, metric] of Object.entries(bucket.databaseByOperation)) {
            const total = windowDatabaseByOperation[operation] ?? {
                count: 0,
                totalDurationMs: 0,
                maxDurationMs: 0,
            };
            total.count += metric.count;
            total.totalDurationMs += metric.totalDurationMs;
            total.maxDurationMs = Math.max(total.maxDurationMs, metric.maxDurationMs);
            windowDatabaseByOperation[operation] = total;
        }
    }
    const windowMetrics = {
        processing: {
            processedBlocks,
            processedTransactions,
            blocksPerSecond: Number((processedBlocks / windowSeconds).toFixed(2)),
            transactionsPerSecond: Number((processedTransactions / windowSeconds).toFixed(2)),
            averageTransactionsPerBlock: batchTotals.blocks
                ? Number((batchTotals.transactions / batchTotals.blocks).toFixed(2))
                : null,
            activeProcessingDurationMs: Number(batchTotals.activeDurationMs.toFixed(1)),
            activeBlocksPerSecond:
                batchTotals.activeDurationMs > 0
                    ? Number(
                          ((batchTotals.blocks * 1000) / batchTotals.activeDurationMs).toFixed(2),
                      )
                    : 0,
            activeTransactionsPerSecond:
                batchTotals.activeDurationMs > 0
                    ? Number(
                          (
                              (batchTotals.transactions * 1000) /
                              batchTotals.activeDurationMs
                          ).toFixed(2),
                      )
                    : 0,
            averageActiveProcessingMsPerBlock: batchTotals.blocks
                ? Number((batchTotals.activeDurationMs / batchTotals.blocks).toFixed(1))
                : null,
            averageActiveProcessingMsPerTransaction: batchTotals.transactions
                ? Number((batchTotals.activeDurationMs / batchTotals.transactions).toFixed(4))
                : null,
            processingBatches: selectedBatches.length,
            averageBlocksPerBatch: selectedBatches.length
                ? Number((batchTotals.blocks / selectedBatches.length).toFixed(2))
                : 0,
            minBlocksPerBatch: selectedBatches.length ? batchTotals.minBlocksPerBatch : 0,
            maxBlocksPerBatch: batchTotals.maxBlocksPerBatch,
            batchSizeDistribution: batchTotals.batchSizeDistribution,
            averageBatchDurationMs: selectedBatches.length
                ? Number((batchTotals.activeDurationMs / selectedBatches.length).toFixed(1))
                : null,
            averageFetchStageDurationMs: selectedBatches.length
                ? Number((batchTotals.fetchStageDurationMs / selectedBatches.length).toFixed(1))
                : null,
            averageProcessingStageDurationMs: selectedBatches.length
                ? Number((batchTotals.processingStageDurationMs / selectedBatches.length).toFixed(1))
                : null,
            averagePersistenceStageDurationMs: selectedBatches.length
                ? Number((batchTotals.persistenceStageDurationMs / selectedBatches.length).toFixed(1))
                : null,
            averageMaxConcurrentFetches: selectedBatches.length
                ? Number((batchTotals.totalMaxConcurrentFetches / selectedBatches.length).toFixed(2))
                : null,
            averageMaxConcurrentProcessing: selectedBatches.length
                ? Number((batchTotals.totalMaxConcurrentProcessing / selectedBatches.length).toFixed(2))
                : null,
            maxObservedConcurrentFetches: batchTotals.maxConcurrentFetches,
            maxObservedConcurrentProcessing: batchTotals.maxConcurrentProcessing,
            averageBlockDurationMs: processedBlocks
                ? Number((sumBucketMetric('blockDurationMsTotal') / processedBlocks).toFixed(1))
                : null,
            averageFilterDurationMs: sumBucketMetric('filterEvaluations')
                ? Number(
                      (
                          sumBucketMetric('predicateDurationMsTotal') /
                          sumBucketMetric('filterEvaluations')
                      ).toFixed(2),
                  )
                : null,
            averageDatabaseBatchWriteDurationMs: processedBlocks
                ? Number(
                      (
                          sumBucketMetric('databaseBatchWriteDurationMsTotal') / processedBlocks
                      ).toFixed(1),
                  )
                : null,
        },
        rpc: {
            totalRequests: rpcRequests,
            failures: rpcFailures,
            rateLimitErrors: sumBucketMetric('rpcRateLimitErrors'),
            timeoutErrors: sumBucketMetric('rpcTimeoutErrors'),
            connectionErrors: sumBucketMetric('rpcConnectionErrors'),
            providerErrors: sumBucketMetric('rpcProviderErrors'),
            jsonRpcErrors: sumBucketMetric('rpcJsonRpcErrors'),
            otherErrors: sumBucketMetric('rpcOtherErrors'),
            retryableFailures: sumBucketMetric('rpcRetryableFailures'),
            averageLatencyMs: rpcRequests
                ? Number((sumBucketMetric('rpcDurationMsTotal') / rpcRequests).toFixed(1))
                : null,
            latencyP95Ms: windowPercentile(0.95),
            methods: Object.entries(windowRpcMethods).map(([method, metric]) => ({
                method,
                ...metric,
            })),
            operations: {
                totalOperations: logicalRpcOperations,
                successfulOperations: successfulRpcOperations,
                failedOperations: failedRpcOperations,
                retriedOperations: sumBucketMetric('rpcRetriedOperations'),
                totalRetryAttempts: sumBucketMetric('rpcRetryAttempts'),
                endpointFailovers: sumBucketMetric('rpcEndpointFailovers'),
                averageAttemptsPerSuccessfulOperation: successfulRpcOperations
                    ? Number(
                          (
                              sumBucketMetric('successfulOperationAttempts') /
                              successfulRpcOperations
                          ).toFixed(2),
                      )
                    : null,
            },
        },
        database: {
            queries: sumBucketMetric('databaseQueries'),
            reads: sumBucketMetric('databaseReads'),
            writes: sumBucketMetric('databaseWrites'),
            other: sumBucketMetric('databaseOther'),
            failures: sumBucketMetric('databaseFailures'),
            averageQueryDurationMs: sumBucketMetric('databaseQueries')
                ? Number(
                      (
                          sumBucketMetric('databaseDurationMsTotal') /
                          sumBucketMetric('databaseQueries')
                      ).toFixed(1),
                  )
                : null,
            batchWrites: selectedBatches.length,
            totalBatchWriteDurationMs: Number(batchTotals.databaseWriteDurationMs.toFixed(1)),
            averageBatchWriteDurationMs: selectedBatches.length
                ? Number((batchTotals.databaseWriteDurationMs / selectedBatches.length).toFixed(1))
                : null,
            averageBatchWriteDurationMsPerBlock: batchTotals.blocks
                ? Number((batchTotals.databaseWriteDurationMs / batchTotals.blocks).toFixed(1))
                : null,
            byOperation: windowDatabaseByOperation,
        },
        filters: {
            evaluations: sumBucketMetric('filterEvaluations'),
            matches: sumBucketMetric('filterMatches'),
            failures: sumBucketMetric('filterFailures'),
            averageDurationMs: sumBucketMetric('filterEvaluations')
                ? Number(
                      (
                          sumBucketMetric('predicateDurationMsTotal') /
                          sumBucketMetric('filterEvaluations')
                      ).toFixed(2),
                  )
                : null,
            byFilter: windowFiltersById,
        },
    };

    return {
        generatedAt: new Date(now).toISOString(),
        window: windowLabel,
        requestedWindowMs,
        availableWindowMs,
        windowCoverage: now - startedAtMs >= requestedWindowMs ? 'complete' : 'partial',
        historyStartedAt: startedAt,
        availableWindows: METRICS_TIME_WINDOWS.map(({ value, label }) => ({ value, label })),
        current,
        windowMetrics,
        rpcEvents: recentRpcErrors,
        catchUpSessions: selectedSessions.map(
            ({ startedAtMs: _startedAtMs, ...session }) => session,
        ),
        batches: latestBatch,
        minuteBuckets: selectedMinuteBuckets.map(
            ({ timestampMs: _timestampMs, ...bucket }) => bucket,
        ),
        retention: {
            oldestBlockSampleAt:
                (blockSamples[blockSamplesStartIndex]?.timestamp as string | undefined) ?? null,
            oldestRpcEventAt:
                (rpcEvents[rpcEventsStartIndex]?.timestamp as string | undefined) ?? null,
            blockSamples: blockSamples.length - blockSamplesStartIndex,
            lagSamples: lagSamples.length - lagSamplesStartIndex,
            rpcEvents: rpcEvents.length - rpcEventsStartIndex,
            catchUpSessions: catchUpSessions.length,
            batches: batchSamples.length,
            minuteBuckets: minuteBuckets.length,
        },
    };
}

let scannerAnalyticsCache: {
    windowLabel: string;
    generatedAtMs: number;
    result: ScannerAnalyticsResponse;
} | null = null;

export function getScannerAnalytics(
    windowLabel: string = DEFAULT_METRICS_WINDOW.value,
): ScannerAnalyticsResponse {
    const selectedWindow = METRICS_TIME_WINDOWS.find((window) => window.value === windowLabel);
    if (!selectedWindow) {
        throw new Error(`Analytics window "${windowLabel}" is not configured`);
    }

    const now = Date.now();
    if (
        scannerAnalyticsCache?.windowLabel === windowLabel &&
        now - scannerAnalyticsCache.generatedAtMs <
            (Number(getDynamicConfigService().getDynamicSettings().analyticsRefreshMs) ||
                METRICS_ANALYTICS_REFRESH_INTERVAL_MS)
    ) {
        return scannerAnalyticsCache.result;
    }

    const current = getCurrentMetrics();
    const sortedRpcDurations = rpcEvents
        .slice(rpcEventsStartIndex)
        .map((event) => ({ timestampMs: event.timestampMs, durationMs: Number(event.durationMs) }))
        .filter((sample) => Number.isFinite(sample.durationMs))
        .sort((left, right) => left.durationMs - right.durationMs);
    const result = buildScannerAnalytics(
        selectedWindow.durationMs,
        windowLabel,
        current,
        sortedRpcDurations,
    );

    // Keep only the most recently requested window; analytics payloads can contain large sample arrays.
    scannerAnalyticsCache = { windowLabel, generatedAtMs: now, result };
    return result;
}

function recordFilterEvaluation(input: FilterMetricEvent): void {
    filterMetrics.evaluations += 1;
    if (input.matched) filterMetrics.matches += 1;
    if (input.failed) filterMetrics.failures += 1;
    filterMetrics.totalDurationMs += input.durationMs;
    filterMetrics.maxDurationMs = Math.max(filterMetrics.maxDurationMs, input.durationMs);
    const key = String(input.filterId);
    const filter = filterMetrics.byFilter[key] ?? {
        evaluations: 0,
        matches: 0,
        failures: 0,
        totalDurationMs: 0,
    };
    filter.evaluations += 1;
    if (input.matched) filter.matches += 1;
    if (input.failed) filter.failures += 1;
    filter.totalDurationMs += input.durationMs;
    filterMetrics.byFilter[key] = filter;
    const bucket = getMinuteBucket(Date.now());
    bucket.filterEvaluations += 1;
    if (input.matched) bucket.filterMatches += 1;
    if (input.failed) bucket.filterFailures += 1;
    bucket.predicateDurationMsTotal += input.durationMs;
    const filterBucket = bucket.filtersById[key] ?? {
        evaluations: 0,
        matches: 0,
        failures: 0,
        totalDurationMs: 0,
    };
    filterBucket.evaluations += 1;
    if (input.matched) filterBucket.matches += 1;
    if (input.failed) filterBucket.failures += 1;
    filterBucket.totalDurationMs += input.durationMs;
    bucket.filtersById[key] = filterBucket;
    publish();
}

function recordDatabaseQuery(input: DatabaseMetricEvent): void {
    databaseQueryTotals.queries += 1;
    databaseQueryTotals[
        input.operation === 'read' ? 'reads' : input.operation === 'write' ? 'writes' : 'other'
    ] += 1;
    databaseQueryTotals.totalDurationMs += input.durationMs;
    databaseQueryTotals.maxDurationMs = Math.max(
        databaseQueryTotals.maxDurationMs,
        input.durationMs,
    );
    databaseQueryTotals.lastQueryAt = new Date().toISOString();
    const operation = databaseQueryTotals.byOperation[input.queryType] ?? {
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
    };
    operation.count += 1;
    operation.totalDurationMs += input.durationMs;
    operation.maxDurationMs = Math.max(operation.maxDurationMs, input.durationMs);
    databaseQueryTotals.byOperation[input.queryType] = operation;
    const bucket = getMinuteBucket(Date.now());
    bucket.databaseQueries += 1;
    if (input.operation === 'read') bucket.databaseReads += 1;
    else if (input.operation === 'write') bucket.databaseWrites += 1;
    else bucket.databaseOther += 1;
    bucket.databaseDurationMsTotal += input.durationMs;
    const operationBucket = bucket.databaseByOperation[input.queryType] ?? {
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
    };
    operationBucket.count += 1;
    operationBucket.totalDurationMs += input.durationMs;
    operationBucket.maxDurationMs = Math.max(operationBucket.maxDurationMs, input.durationMs);
    bucket.databaseByOperation[input.queryType] = operationBucket;
    publish();
}

function recordRpcOperation(input: RpcOperationMetricEvent): void {
    rpcOperationTotals.totalOperations += 1;
    if (input.outcome === 'success') {
        rpcOperationTotals.successfulOperations += 1;
        rpcOperationTotals.totalSuccessfulAttempts += input.attempts;
    } else {
        rpcOperationTotals.failedOperations += 1;
    }
    if (input.retryCount > 0) rpcOperationTotals.retriedOperations += 1;
    rpcOperationTotals.totalRetryAttempts += input.retryCount;
    rpcOperationTotals.endpointFailovers += input.endpointFailovers;
    const bucket = getMinuteBucket(Date.now());
    bucket.logicalRpcOperations += 1;
    if (input.outcome === 'success') bucket.successfulOperationAttempts += input.attempts;
    bucket.rpcRetriedOperations += input.retryCount > 0 ? 1 : 0;
    bucket.rpcRetryAttempts += input.retryCount;
    bucket.rpcEndpointFailovers += input.endpointFailovers;
    if (input.outcome === 'failure') bucket.rpcOperationFailures += 1;
    publish();
}

subscribeToRpcMetricEvents(recordRpcRequest);
subscribeToRpcOperationMetricEvents(recordRpcOperation);
subscribeToDatabaseMetricEvents(recordDatabaseQuery);
subscribeToFilterMetricEvents(recordFilterEvaluation);
