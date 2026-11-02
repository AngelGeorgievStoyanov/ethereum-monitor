import type { ScannerAnalyticsResponse } from '../types/scanner-analytics.types';
import { getDynamicConfigService } from './dynamicConfigService';
import { subscribeToRpcMetricEvents, type RpcMetricEventInput } from '../metrics/metricsEventBus';
import { SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS } from '../constants/scanner.constants';

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

const MAX_BLOCK_SAMPLES = 10000;
const MAX_RPC_EVENTS = 1000;
const MAX_CATCHUP_SESSIONS = 50;
const MAX_BATCH_SAMPLES = 1000;
const startedAt = new Date().toISOString();
const blockSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const rpcEvents: Array<Record<string, unknown> & { timestampMs: number }> = [];
const catchUpSessions: Array<Record<string, unknown> & { startedAtMs: number }> = [];
const batchSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const finalizedSamples: Array<{ timestampMs: number; blockNumber: number }> = [];
const lagSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const endpointTotals = new Map<number, { attempts: number; successes: number; failures: number; retryableFailures: number; durationMs: number; lastFailureAt: string | null }>();
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
let recoveryMetrics: Record<string, number> = {};

function publish(): void {
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
        publishTimer = undefined;
        getDynamicConfigService().publishRuntimeMetrics(getSnapshot());
    }, 1000);
    publishTimer.unref?.();
}

function trimSamples(now: number): void {
    while (blockSamples.length > 0 && (blockSamples.length > MAX_BLOCK_SAMPLES || now - blockSamples[0].timestampMs > 86400000)) blockSamples.shift();
    while (rpcEvents.length > MAX_RPC_EVENTS) rpcEvents.shift();
    while (catchUpSessions.length > MAX_CATCHUP_SESSIONS) catchUpSessions.shift();
    while (batchSamples.length > MAX_BATCH_SAMPLES) batchSamples.shift();
    while (finalizedSamples.length > 0 && now - finalizedSamples[0].timestampMs > 3600000) finalizedSamples.shift();
    while (lagSamples.length > 1000) lagSamples.shift();
}

function getSnapshot() {
    const now = Date.now();
    trimSamples(now);
    const recent = blockSamples.filter((sample) => now - sample.timestampMs <= 60000);
    const sum = (key: string) => recent.reduce((total, sample) => total + Number(sample[key] ?? 0), 0);
    const average = (key: string) => recent.length ? Number((sum(key) / recent.length).toFixed(1)) : null;
    const totalTransactions = totalProcessedTransactions;
    const lagBlocks = latestFinalizedBlock !== null && lastProcessedBlock !== null
        ? Math.max(0, latestFinalizedBlock - lastProcessedBlock) : null;
    const recentTransactions = sum('transactionCount');
    const recentFinalized = finalizedSamples.filter((sample) => now - sample.timestampMs <= 60000);
    const finalizedElapsedMs = recentFinalized.length > 1
        ? recentFinalized[recentFinalized.length - 1].timestampMs - recentFinalized[0].timestampMs
        : 0;
    const chainBlocksPerSecond = finalizedElapsedMs > 0
        ? Number(((recentFinalized[recentFinalized.length - 1].blockNumber - recentFinalized[0].blockNumber) * 1000 / finalizedElapsedMs).toFixed(2))
        : null;
    const blocksPerSecondLastMinute = Number((recent.length / 60).toFixed(2));
    const lagReductionBlocksPerSecond = chainBlocksPerSecond === null
        ? null
        : Number((blocksPerSecondLastMinute - chainBlocksPerSecond).toFixed(2));
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
        },
        catchUp: {
            active: catchUpActive,
            currentLagBlocks: lagBlocks,
            chainBlocksPerSecond,
            lagReductionBlocksPerSecond,
            estimatedRemainingSeconds: estimatedCatchUpSeconds,
            sessions: catchUpSessions.map(({ startedAtMs: _startedAtMs, ...session }) => session),
        },
        database: { ...databaseMetrics, averageWriteDurationMs: databaseMetrics.writes ? Number((databaseMetrics.totalWriteDurationMs / databaseMetrics.writes).toFixed(1)) : null },
        recovery: { ...recoveryMetrics },
        recentRpcErrors: rpcEvents.filter((event) => event.outcome === 'failure').slice(-100).map(({ timestampMs: _timestampMs, ...event }) => event),
        recentBlocks: blockSamples.slice(-30).map(({ timestampMs: _timestampMs, ...sample }) => sample),
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
    session.lagReductionBlocks = Number(session.initialLagBlocks);
    session.lagReductionPerSecond = durationMs > 0 ? Number((Number(session.initialLagBlocks) * 1000 / durationMs).toFixed(2)) : 0;
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
    const normalized = message.toLowerCase();
    let failureKind: string | null = null;
    if (input.outcome === 'failure') {
        if (/429|too many requests|rate.?limit/.test(normalized)) failureKind = 'rateLimit';
        else if (/timeout|timed out|etimedout/.test(normalized)) failureKind = 'timeout';
        else if (/econn|enotfound|eai_again|socket hang up|network error/.test(normalized)) failureKind = 'connection';
        else if (/\b5\d\d\b/.test(normalized)) failureKind = 'server';
        else if (/\-32\d{3,4}|json.?rpc/.test(normalized)) failureKind = 'jsonRpc';
        else failureKind = 'other';
        rpcTotals.failures += 1;
        if (input.retryable) rpcTotals.retryableFailures += 1;
        rpcTotals.lastErrorAt = new Date(now).toISOString();
        if (failureKind === 'rateLimit') rpcTotals.rateLimitErrors += 1;
        else if (failureKind === 'timeout') rpcTotals.timeoutErrors += 1;
        else if (failureKind === 'connection') rpcTotals.connectionErrors += 1;
        else if (failureKind === 'server') rpcTotals.serverErrors += 1;
        else if (failureKind === 'jsonRpc') rpcTotals.jsonRpcErrors += 1;
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
        recentBlocks: blockSamples.slice(-30).map((sample) => ({
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

export function getScannerAnalytics(windowMs = 3600000): ScannerAnalyticsResponse {
    const now = Date.now();
    const since = now - Math.max(60000, Math.min(windowMs, 86400000));
    const selectedBlocks = blockSamples.filter((sample) => sample.timestampMs >= since);
    const selectedLag = lagSamples.filter((sample) => sample.timestampMs >= since);
    const selectedRpc = rpcEvents.filter((event) => event.timestampMs >= since);
    const selectedSessions = catchUpSessions.filter((session) => session.startedAtMs >= since);
    const selectedBatches = batchSamples.filter((sample) => sample.timestampMs >= since);
    const current = getSnapshot();
    const response: ScannerAnalyticsResponse = {
        generatedAt: new Date(now).toISOString(),
        window: String(Math.max(60000, Math.min(windowMs, 86400000))),
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
    getDynamicConfigService().publishRuntimeAnalytics(response);
    return getDynamicConfigService().getRuntimeAnalyticsSnapshot() as ScannerAnalyticsResponse;
}

subscribeToRpcMetricEvents(recordRpcRequest);

export function markScannerStopped(): void {
    scannerRunning = false;
    if (catchUpActive) completeCatchUp('interrupted');
    publish();
}
