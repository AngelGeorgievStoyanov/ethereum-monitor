import type { ScannerAnalyticsResponse } from '../types/scanner-analytics.types';
import { performance } from 'node:perf_hooks';
import { getDynamicConfigService } from './dynamicConfigService';
import { subscribeToRpcMetricEvents, subscribeToRpcOperationMetricEvents, type RpcMetricEventInput, type RpcOperationMetricEvent } from '../metrics/metricsEventBus';
import { SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS } from '../constants/scanner.constants';
import { classifyRpcError } from '../utils/classifyRpcError';
import { subscribeToDatabaseMetricEvents, type DatabaseMetricEvent } from '../metrics/databaseMetricsEventBus';
import { METRICS_RETENTION_MS, METRICS_SAMPLE_LIMITS, DEFAULT_METRICS_WINDOW, METRICS_TIME_WINDOWS, METRICS_ANALYTICS_REFRESH_INTERVAL_MS } from '../constants/scanner-metrics.constants';

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
const rpcEvents: Array<Record<string, unknown> & { timestampMs: number }> = [];
const catchUpSessions: Array<Record<string, unknown> & { startedAtMs: number }> = [];
const batchSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const finalizedSamples: Array<{ timestampMs: number; blockNumber: number }> = [];
const lagSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const endpointTotals = new Map<number, { attempts: number; successes: number; failures: number; retryableFailures: number; durationMs: number; lastFailureAt: string | null }>();
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
    jsonRpcErrors: 0,
    otherErrors: 0,
    totalDurationMs: 0,
    lastErrorAt: null as string | null,
};
let latestFinalizedBlock: number | null = null;
let latestFinalizedAt: string | null = null;
let lastProcessedBlock: number | null = null;
let lastProcessedAt: string | null = null;
let rpcAvailable: boolean | null = null;
let scannerRunning = false;
let scannerPaused = false;
let pauseMode: string | null = null;
let activeFiltersCount = 0;
let maxBlocksPerCatchup = 0;
let maxParallelBlocks = 1;
let parallelProcessingLagBlocks = 0;
let catchUpActive = false;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let lastAnalyticsPublishedAt = 0;
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
const databaseMetrics = { writes: 0, failures: 0, totalWriteDurationMs: 0, lastErrorAt: null as string | null, lastError: null as string | null };
const databaseQueryTotals = {
    queries: 0,
    reads: 0,
    writes: 0,
    other: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastQueryAt: null as string | null,
    byOperation: {} as Record<string, { count: number; totalDurationMs: number; maxDurationMs: number }>,
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
    publishTimer = setTimeout(() => {
        publishTimer = undefined;
        const now = Date.now();
        const currentSnapshot = getSnapshot();
        getDynamicConfigService().publishRuntimeMetrics(currentSnapshot);
        const runtime = currentSnapshot as {
            scanner: { running: boolean; uptimeSeconds: number; activeFiltersCount: number };
            chain: { latestFinalizedBlock: number | null; latestFinalizedAt: string | null; lagBlocks: number | null; rpcAvailable: boolean | null };
            rpc: { endpoints: Array<Record<string, unknown>> };
            recovery: Record<string, number>;
        };
        getDynamicConfigService().updateScannerStatusSnapshot({
            scannerRunning: runtime.scanner.running,
            processUptimeSeconds: runtime.scanner.uptimeSeconds,
            activeFiltersCount: runtime.scanner.activeFiltersCount,
            latestFinalizedBlock: runtime.chain.latestFinalizedBlock,
            latestFinalizedAt: runtime.chain.latestFinalizedAt,
            lagBlocks: runtime.chain.lagBlocks,
            rpcAvailable: runtime.chain.rpcAvailable ?? false,
            rpcMetrics: runtime.rpc.endpoints,
            recoveryMetrics: runtime.recovery,
            processingMetrics: getBlockProcessingMetrics(),
        });
        if (now - lastAnalyticsPublishedAt >= METRICS_ANALYTICS_REFRESH_INTERVAL_MS) {
            publishScannerAnalyticsSnapshots(currentSnapshot);
            lastAnalyticsPublishedAt = now;
        }
    }, 1000);
    publishTimer.unref?.();
}

function trimSamples(now: number): void {
    while (blockSamples.length > 0 && (blockSamples.length > METRICS_SAMPLE_LIMITS.blocks || now - blockSamples[0].timestampMs > METRICS_RETENTION_MS)) blockSamples.shift();
    while (rpcEvents.length > 0 && (rpcEvents.length > METRICS_SAMPLE_LIMITS.rpcEvents || now - rpcEvents[0].timestampMs > METRICS_RETENTION_MS)) rpcEvents.shift();
    while (catchUpSessions.length > 0 && (catchUpSessions.length > METRICS_SAMPLE_LIMITS.catchUpSessions || now - catchUpSessions[0].startedAtMs > METRICS_RETENTION_MS)) catchUpSessions.shift();
    while (batchSamples.length > 0 && (batchSamples.length > METRICS_SAMPLE_LIMITS.batches || now - batchSamples[0].timestampMs > METRICS_RETENTION_MS)) batchSamples.shift();
    while (finalizedSamples.length > 0 && now - finalizedSamples[0].timestampMs > METRICS_RETENTION_MS) finalizedSamples.shift();
    while (lagSamples.length > 0 && (lagSamples.length > METRICS_SAMPLE_LIMITS.lag || now - lagSamples[0].timestampMs > METRICS_RETENTION_MS)) lagSamples.shift();
}

function getSnapshot() {
    const now = Date.now();
    trimSamples(now);
    const cpuUsage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    const cpuElapsedMs = Math.max(1, now - lastCpuSampleAt);
    lastCpuSampleAt = now;
    const cpuPercent = Number((((cpuUsage.user + cpuUsage.system) / 1000 / cpuElapsedMs) * 100).toFixed(2));
    const eventLoopUtilization = performance.eventLoopUtilization(lastEventLoopUtilization);
    lastEventLoopUtilization = performance.eventLoopUtilization();
    const memoryUsage = process.memoryUsage();
    const recent = blockSamples.filter((sample) => now - sample.timestampMs <= 60000);
    const sum = (key: string) => recent.reduce((total, sample) => total + Number(sample[key] ?? 0), 0);
    const average = (key: string) => recent.length ? Number((sum(key) / recent.length).toFixed(1)) : null;
    const totalTransactions = totalProcessedTransactions;
    const lagBlocks = latestFinalizedBlock !== null && lastProcessedBlock !== null
        ? Math.max(0, latestFinalizedBlock - lastProcessedBlock) : null;
    const recentTransactions = sum('transactionCount');
    const recentFinalized = finalizedSamples.filter((sample) => now - sample.timestampMs <= 900000);
    const finalizedElapsedMs = recentFinalized.length > 1
        ? recentFinalized[recentFinalized.length - 1].timestampMs - recentFinalized[0].timestampMs
        : 0;
    const chainBlocksPerSecond = finalizedElapsedMs > 0
        ? Number(((recentFinalized[recentFinalized.length - 1].blockNumber - recentFinalized[0].blockNumber) * 1000 / finalizedElapsedMs).toFixed(2))
        : null;
    const blocksPerSecondLastMinute = Number((recent.length / 60).toFixed(2));
    const activeCatchUpSession = catchUpSessions[catchUpSessions.length - 1];
    const activeCatchUpElapsedMs = activeCatchUpSession?.status === 'running'
        ? now - activeCatchUpSession.startedAtMs
        : 0;
    const lagReductionBlocksPerSecond = activeCatchUpSession?.status === 'running' && lagBlocks !== null && activeCatchUpElapsedMs >= 10000
        ? Number(((Number(activeCatchUpSession.initialLagBlocks) - lagBlocks) * 1000 / activeCatchUpElapsedMs).toFixed(2))
        : null;
    const estimatedCatchUpSeconds = lagBlocks !== null && lagBlocks > 0 && lagReductionBlocksPerSecond !== null && lagReductionBlocksPerSecond > 0
        ? Number((lagBlocks / lagReductionBlocksPerSecond).toFixed(1))
        : null;
    const endpoints = Array.from(endpointTotals.entries()).map(([index, value]) => ({
        index, attempts: value.attempts, successes: value.successes, failures: value.failures,
        retryableFailures: value.retryableFailures,
        totalDurationMs: value.durationMs,
        lastFailureAt: value.lastFailureAt,
        averageLatencyMs: value.attempts ? Number((value.durationMs / value.attempts).toFixed(1)) : null,
    }));
    const latencySamples = rpcEvents.map((event) => Number(event.durationMs)).sort((a, b) => a - b);
    const percentile = (ratio: number) => latencySamples.length
        ? latencySamples[Math.min(latencySamples.length - 1, Math.ceil(latencySamples.length * ratio) - 1)]
        : null;
    const methodTotals = new Map<string, { requests: number; successes: number; failures: number; totalDurationMs: number }>();
    for (const event of rpcEvents) {
        const method = String(event.method);
        const value = methodTotals.get(method) ?? { requests: 0, successes: 0, failures: 0, totalDurationMs: 0 };
        value.requests += 1;
        value.totalDurationMs += Number(event.durationMs);
        if (event.outcome === 'success') value.successes += 1;
        else value.failures += 1;
        methodTotals.set(method, value);
    }
    return {
        startedAt,
        updatedAt: new Date(now).toISOString(),
        runtime: {
            memoryRssMb: Number((memoryUsage.rss / 1048576).toFixed(1)),
            memoryHeapUsedMb: Number((memoryUsage.heapUsed / 1048576).toFixed(1)),
            memoryHeapTotalMb: Number((memoryUsage.heapTotal / 1048576).toFixed(1)),
            memoryExternalMb: Number((memoryUsage.external / 1048576).toFixed(1)),
            cpuPercent,
            eventLoopUtilizationPercent: Number((eventLoopUtilization.utilization * 100).toFixed(2)),
        },
        scanner: { running: scannerRunning, paused: scannerPaused, pauseMode, uptimeSeconds: Math.floor(process.uptime()), activeFiltersCount, maxBlocksPerCatchup, maxParallelBlocks, parallelProcessingLagBlocks },
        chain: { latestFinalizedBlock, latestFinalizedAt, lastProcessedBlock, lastProcessedAt, lagBlocks, rpcAvailable },
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
            transactionsPerSecondLastMinute: Number((recentTransactions / 60).toFixed(2)),
            averageTransactionsPerBlock: totalProcessedBlocks ? Number((totalTransactions / totalProcessedBlocks).toFixed(1)) : 0,
            averageBlockDurationMs: average('blockDurationMs'),
            averageFetchDurationMs: average('fetchDurationMs'),
            averageGetBlockDurationMs: average('getBlockDurationMs'),
            averageGetBlockReceiptsDurationMs: average('getBlockReceiptsDurationMs'),
            averageFilterMatchingDurationMs: average('filterMatchingDurationMs'),
            averageDatabaseWriteDurationMs: average('databaseWriteDurationMs'),
            lastBlockTransactionCount: blockSamples.length ? Number(blockSamples[blockSamples.length - 1].transactionCount) : null,
        },
        rpc: {
            ...rpcTotals,
            averageLatencyMs: rpcTotals.totalRequests ? Number((rpcTotals.totalDurationMs / rpcTotals.totalRequests).toFixed(1)) : null,
            latencyP50Ms: percentile(0.5),
            latencyP95Ms: percentile(0.95),
            latencyP99Ms: percentile(0.99),
            methods: Array.from(methodTotals.entries()).map(([method, value]) => ({ method, ...value })),
            endpoints,
            operations: {
                ...rpcOperationTotals,
                averageAttemptsPerSuccessfulOperation: rpcOperationTotals.successfulOperations
                    ? Number((rpcOperationTotals.totalSuccessfulAttempts / rpcOperationTotals.successfulOperations).toFixed(2))
                    : null,
                retryRate: rpcOperationTotals.totalOperations
                    ? Number((rpcOperationTotals.retriedOperations / rpcOperationTotals.totalOperations * 100).toFixed(2))
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
                const lagReductionBlocks = Math.max(0, Number(session.initialLagBlocks) - finalLagBlocks);
                return {
                    ...session,
                    durationMs,
                    blocksPerSecond: durationMs > 0 ? Number((processedBlocks * 1000 / durationMs).toFixed(2)) : 0,
                    transactionsPerSecond: durationMs > 0 ? Number((processedTransactions * 1000 / durationMs).toFixed(2)) : 0,
                    finalLagBlocks,
                    lagReductionBlocks,
                    lagReductionPerSecond: durationMs > 0 ? Number((lagReductionBlocks * 1000 / durationMs).toFixed(2)) : 0,
                };
            }),
        },
        database: {
            ...databaseMetrics,
            averageWriteDurationMs: databaseMetrics.writes ? Number((databaseMetrics.totalWriteDurationMs / databaseMetrics.writes).toFixed(1)) : null,
            ...databaseQueryTotals,
            averageQueryDurationMs: databaseQueryTotals.queries ? Number((databaseQueryTotals.totalDurationMs / databaseQueryTotals.queries).toFixed(1)) : null,
        },
        recovery: { ...recoveryMetrics },
        recentRpcErrors: rpcEvents.filter((event) => event.outcome === 'failure').slice(-METRICS_SAMPLE_LIMITS.recentRpcErrors).map(({ timestampMs: _timestampMs, ...event }) => event),
        recentBlocks: recent.slice(-30).map(({ timestampMs: _timestampMs, ...sample }) => sample),
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
    session.blocksPerSecond = durationMs > 0 ? Number((Number(session.processedBlocks) * 1000 / durationMs).toFixed(2)) : 0;
    const finalLagBlocks = latestFinalizedBlock !== null && lastProcessedBlock !== null
        ? Math.max(0, latestFinalizedBlock - lastProcessedBlock)
        : Number(session.initialLagBlocks);
    const lagReductionBlocks = Math.max(0, Number(session.initialLagBlocks) - finalLagBlocks);
    session.finalLagBlocks = finalLagBlocks;
    session.lagReductionBlocks = lagReductionBlocks;
    session.lagReductionPerSecond = durationMs > 0 ? Number((lagReductionBlocks * 1000 / durationMs).toFixed(2)) : 0;
    session.transactionsPerSecond = durationMs > 0 ? Number((Number(session.processedTransactions) * 1000 / durationMs).toFixed(2)) : 0;
    session.status = status;
    catchUpActive = false;
}

export function recordFinalizedBlock(blockNumber: number): void {
    latestFinalizedBlock = blockNumber;
    latestFinalizedAt = new Date().toISOString();
    finalizedSamples.push({ timestampMs: Date.now(), blockNumber });
    trimSamples(Date.now());
    rpcAvailable = true;
    const lag = lastProcessedBlock === null ? null : Math.max(0, blockNumber - lastProcessedBlock);
    lagSamples.push({ timestamp: latestFinalizedAt, timestampMs: Date.now(), latestFinalizedBlock: blockNumber, lastProcessedBlock, lagBlocks: lag });
    if (lag !== null && lag > SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS && !catchUpActive) {
        const now = Date.now();
        catchUpSessions.push({
            startedAt: new Date(now).toISOString(), startedAtMs: now, completedAt: null,
            startBlock: (lastProcessedBlock ?? blockNumber) + 1, endBlock: null,
            initialLagBlocks: lag, processedBlocks: 0, processedTransactions: 0,
            durationMs: null, blocksPerSecond: null, transactionsPerSecond: null, status: 'running',
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
    const currentLag = latestFinalizedBlock === null ? null : Math.max(0, latestFinalizedBlock - lastProcessedBlock);
    lagSamples.push({ timestamp, timestampMs: now, latestFinalizedBlock, lastProcessedBlock, lagBlocks: currentLag });
    const session = catchUpSessions[catchUpSessions.length - 1];
    if (session?.status === 'running') {
        session.processedBlocks = Number(session.processedBlocks) + 1;
        session.processedTransactions = Number(session.processedTransactions) + input.transactionCount;
    }
    if (latestFinalizedBlock !== null && input.blockNumber >= latestFinalizedBlock && catchUpActive) completeCatchUp('completed');
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
        else if (failureKind === 'provider') rpcTotals.serverErrors += 1;
        else if (failureKind === 'rpc') rpcTotals.jsonRpcErrors += 1;
        else rpcTotals.otherErrors += 1;
    } else rpcTotals.successes += 1;
    rpcTotals.totalRequests += 1;
    rpcTotals.totalDurationMs += input.durationMs;
    const endpoint = endpointTotals.get(input.endpointIndex) ?? { attempts: 0, successes: 0, failures: 0, retryableFailures: 0, durationMs: 0, lastFailureAt: null as string | null };
    endpoint.attempts += 1;
    endpoint.durationMs += input.durationMs;
    if (input.outcome === 'success') endpoint.successes += 1;
    else {
        endpoint.failures += 1;
        if (input.retryable) endpoint.retryableFailures += 1;
        endpoint.lastFailureAt = new Date(now).toISOString();
    }
    endpointTotals.set(input.endpointIndex, endpoint);
    rpcEvents.push({
        timestamp: new Date(now).toISOString(), timestampMs: now, method: input.method,
        endpointIndex: input.endpointIndex, durationMs: input.durationMs, outcome: input.outcome,
        failureKind, message: input.outcome === 'failure' ? message.slice(0, 500) : null,
    });
    trimSamples(now);
    publish();
}

export function updateScannerRuntimeContext(input: {
    running?: boolean; paused?: boolean; pauseMode?: string | null; activeFiltersCount?: number;
    lastProcessedBlock?: number | null; recovery?: Record<string, number>;
    maxBlocksPerCatchup?: number; maxParallelBlocks?: number; parallelProcessingLagBlocks?: number;
}): void {
    if (input.running !== undefined) scannerRunning = input.running;
    if (input.paused !== undefined) scannerPaused = input.paused;
    if (input.pauseMode !== undefined) pauseMode = input.pauseMode;
    if (input.activeFiltersCount !== undefined) activeFiltersCount = input.activeFiltersCount;
    if (input.lastProcessedBlock !== undefined) lastProcessedBlock = input.lastProcessedBlock;
    if (input.maxBlocksPerCatchup !== undefined) maxBlocksPerCatchup = input.maxBlocksPerCatchup;
    if (input.maxParallelBlocks !== undefined) maxParallelBlocks = input.maxParallelBlocks;
    if (input.parallelProcessingLagBlocks !== undefined) parallelProcessingLagBlocks = input.parallelProcessingLagBlocks;
    if (input.recovery) recoveryMetrics = { ...input.recovery };
    publish();
}


export function getBlockProcessingMetrics() {
    const now = Date.now();
    const recent = blockSamples.filter((sample) => now - sample.timestampMs <= 60000);
    const recentTotal = (key: string) => recent.reduce((total, sample) => total + Number(sample[key] ?? 0), 0);
    const average = (key: string) => recent.length ? Number((recentTotal(key) / recent.length).toFixed(1)) : null;
    const last = blockSamples[blockSamples.length - 1];
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
        blocksProcessedLastMinute: recent.length,
        blocksPerSecondLastMinute: Number((recent.length / 60).toFixed(2)),
        averageBlockDurationLastMinuteMs: average('blockDurationMs'),
        averageFetchDurationLastMinuteMs: average('fetchDurationMs'),
        averageDatabaseWriteDurationLastMinuteMs: average('databaseWriteDurationMs'),
        recentBlocks: recent.slice(-30).map((sample) => ({
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

export function getScannerRuntimeMetrics() {
    return getDynamicConfigService().getRuntimeMetricsSnapshot();
}


export function recordProcessingBatch(input: {
    startBlock: number;
    endBlock: number;
    blocks: number;
    transactions: number;
    durationMs: number;
    databaseWriteDurationMs: number;
}): void {
    const now = Date.now();
    batchSamples.push({
        ...input,
        timestamp: new Date(now).toISOString(),
        timestampMs: now,
        blocksPerSecond: input.durationMs > 0 ? Number((input.blocks * 1000 / input.durationMs).toFixed(2)) : 0,
        transactionsPerSecond: input.durationMs > 0 ? Number((input.transactions * 1000 / input.durationMs).toFixed(2)) : 0,
    });
    databaseMetrics.writes += 1;
    databaseMetrics.totalWriteDurationMs += input.databaseWriteDurationMs;
    trimSamples(now);
    publish();
}


export function recordDatabaseFailure(operation: string, message: string): void {
    databaseMetrics.failures += 1;
    databaseMetrics.lastErrorAt = new Date().toISOString();
    databaseMetrics.lastError = (operation + ': ' + message).slice(0, 500);
    publish();
}

function buildScannerAnalytics(
    windowMs: number,
    windowLabel: string,
    current: ReturnType<typeof getSnapshot>,
): ScannerAnalyticsResponse {
    const now = Date.now();
    const requestedWindowMs = windowLabel === 'available'
        ? METRICS_RETENTION_MS
        : Math.max(60000, Math.min(windowMs, METRICS_RETENTION_MS));
    const availableWindowMs = Math.max(0, Math.min(requestedWindowMs, now - startedAtMs));
    const since = now - availableWindowMs;
    const selectedBlocks = blockSamples.filter((sample) => sample.timestampMs >= since);
    const selectedLag = lagSamples.filter((sample) => sample.timestampMs >= since);
    const selectedRpc = rpcEvents.filter((event) => event.timestampMs >= since);
    const selectedSessions = catchUpSessions.filter((session) => session.startedAtMs >= since);
    const selectedBatches = batchSamples.filter((sample) => sample.timestampMs >= since);

    return {
        generatedAt: new Date(now).toISOString(),
        window: windowLabel,
        requestedWindowMs,
        availableWindowMs,
        windowCoverage: windowLabel === 'available'
            ? 'available'
            : now - startedAtMs >= requestedWindowMs ? 'complete' : 'partial',
        historyStartedAt: startedAt,
        current,
        blockSamples: selectedBlocks.map(({ timestampMs: _timestampMs, ...sample }) => sample),
        lagSamples: selectedLag.map(({ timestampMs: _timestampMs, ...sample }) => sample),
        rpcEvents: selectedRpc.map(({ timestampMs: _timestampMs, ...event }) => event),
        catchUpSessions: selectedSessions.map(({ startedAtMs: _startedAtMs, ...session }) => session),
        batches: selectedBatches.map(({ timestampMs: _timestampMs, ...sample }) => sample),
        retention: {
            oldestBlockSampleAt: (blockSamples[0]?.timestamp as string | undefined) ?? null,
            oldestRpcEventAt: (rpcEvents[0]?.timestamp as string | undefined) ?? null,
            blockSamples: blockSamples.length,
            lagSamples: lagSamples.length,
            rpcEvents: rpcEvents.length,
            catchUpSessions: catchUpSessions.length,
            batches: batchSamples.length,
        },
    };
}

function publishScannerAnalyticsSnapshots(current: ReturnType<typeof getSnapshot>): void {
    const snapshots: Record<string, ScannerAnalyticsResponse> = {};
    for (const window of METRICS_TIME_WINDOWS) {
        snapshots[window.value] = buildScannerAnalytics(window.durationMs, window.value, current);
    }
    snapshots.available = buildScannerAnalytics(METRICS_RETENTION_MS, 'available', current);
    getDynamicConfigService().publishRuntimeAnalytics(snapshots);
}

export function getScannerAnalytics(windowLabel: string = DEFAULT_METRICS_WINDOW.value): ScannerAnalyticsResponse {
    const snapshots = getDynamicConfigService().getRuntimeAnalyticsSnapshot() as
        | Record<string, ScannerAnalyticsResponse>
        | null;
    if (snapshots?.[windowLabel]) return snapshots[windowLabel];

    // The first request can arrive before the first scheduled metrics publication.
    const current = getSnapshot();
    publishScannerAnalyticsSnapshots(current);
    const initializedSnapshots = getDynamicConfigService().getRuntimeAnalyticsSnapshot() as
        | Record<string, ScannerAnalyticsResponse>
        | null;
    const snapshot = initializedSnapshots?.[windowLabel];
    if (!snapshot) throw new Error(`Analytics window "${windowLabel}" is not configured`);
    return snapshot;
}

function recordDatabaseQuery(input: DatabaseMetricEvent): void {
    databaseQueryTotals.queries += 1;
    databaseQueryTotals[input.operation === 'read' ? 'reads' : input.operation === 'write' ? 'writes' : 'other'] += 1;
    databaseQueryTotals.totalDurationMs += input.durationMs;
    databaseQueryTotals.maxDurationMs = Math.max(databaseQueryTotals.maxDurationMs, input.durationMs);
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
    publish();
}

subscribeToRpcMetricEvents(recordRpcRequest);
subscribeToRpcOperationMetricEvents(recordRpcOperation);
subscribeToDatabaseMetricEvents(recordDatabaseQuery);

export function markScannerStopped(): void {
    scannerRunning = false;
    if (catchUpActive) completeCatchUp('interrupted');
    publish();
}
