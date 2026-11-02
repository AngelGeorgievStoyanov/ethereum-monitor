import type { ScannerAnalyticsResponse } from '../types/scanner-analytics.types';
import { getDynamicConfigService } from './dynamicConfigService';

type BlockInput = {
    blockNumber: number;
    transactionCount: number;
    blockDurationMs: number;
    fetchDurationMs: number;
    getBlockDurationMs: number;
    getBlockReceiptsDurationMs: number;
    filterMatchingDurationMs: number;
    databaseWriteDurationMs: number;
    nativeMatches: number;
    erc20Matches: number;
};

type RpcInput = {
    method: string;
    endpointIndex: number;
    durationMs: number;
    outcome: 'success' | 'failure';
    message?: string;
};

const MAX_BLOCK_SAMPLES = 10000;
const MAX_RPC_EVENTS = 1000;
const MAX_CATCHUP_SESSIONS = 50;
const startedAt = new Date().toISOString();
const blockSamples: Array<Record<string, unknown> & { timestampMs: number }> = [];
const rpcEvents: Array<Record<string, unknown> & { timestampMs: number }> = [];
const catchUpSessions: Array<Record<string, unknown> & { startedAtMs: number }> = [];
const endpointTotals = new Map<number, { attempts: number; successes: number; failures: number; durationMs: number }>();
const rpcTotals = {
    totalRequests: 0,
    successes: 0,
    failures: 0,
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
let catchUpActive = false;
let recoveryMetrics: Record<string, number> = {};

function publish(): void {
    getDynamicConfigService().publishRuntimeMetrics(getSnapshot());
}

function trimSamples(now: number): void {
    while (blockSamples.length > 0 && (blockSamples.length > MAX_BLOCK_SAMPLES || now - blockSamples[0].timestampMs > 86400000)) blockSamples.shift();
    while (rpcEvents.length > MAX_RPC_EVENTS) rpcEvents.shift();
    while (catchUpSessions.length > MAX_CATCHUP_SESSIONS) catchUpSessions.shift();
}

function getSnapshot() {
    const now = Date.now();
    trimSamples(now);
    const recent = blockSamples.filter((sample) => now - sample.timestampMs <= 60000);
    const sum = (key: string) => recent.reduce((total, sample) => total + Number(sample[key] ?? 0), 0);
    const average = (key: string) => recent.length ? Number((sum(key) / recent.length).toFixed(1)) : null;
    const totalTransactions = blockSamples.reduce((total, sample) => total + Number(sample.transactionCount ?? 0), 0);
    const totalNativeMatches = blockSamples.reduce((total, sample) => total + Number(sample.nativeMatches ?? 0), 0);
    const totalErc20Matches = blockSamples.reduce((total, sample) => total + Number(sample.erc20Matches ?? 0), 0);
    const lagBlocks = latestFinalizedBlock !== null && lastProcessedBlock !== null
        ? Math.max(0, latestFinalizedBlock - lastProcessedBlock) : null;
    const recentTransactions = sum('transactionCount');
    const endpoints = Array.from(endpointTotals.entries()).map(([index, value]) => ({
        index, attempts: value.attempts, successes: value.successes, failures: value.failures,
        averageLatencyMs: value.attempts ? Number((value.durationMs / value.attempts).toFixed(1)) : null,
    }));
    return {
        startedAt,
        updatedAt: new Date(now).toISOString(),
        scanner: { running: scannerRunning, paused: scannerPaused, pauseMode, uptimeSeconds: Math.floor(process.uptime()), activeFiltersCount },
        chain: { latestFinalizedBlock, latestFinalizedAt, lastProcessedBlock, lastProcessedAt, lagBlocks, rpcAvailable },
        processing: {
            processedBlocks: blockSamples.length,
            processedTransactions: totalTransactions,
            totalNativeMatches,
            totalErc20Matches,
            blocksPerSecondLastMinute: Number((recent.length / 60).toFixed(2)),
            transactionsPerSecondLastMinute: Number((recentTransactions / 60).toFixed(2)),
            averageTransactionsPerBlock: blockSamples.length ? Number((totalTransactions / blockSamples.length).toFixed(1)) : 0,
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
            endpoints,
        },
        catchUp: { active: catchUpActive, sessions: catchUpSessions.map(({ startedAtMs: _startedAtMs, ...session }) => session) },
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
    session.transactionsPerSecond = durationMs > 0 ? Number((Number(session.processedTransactions) * 1000 / durationMs).toFixed(2)) : 0;
    session.status = status;
    catchUpActive = false;
}

export function recordFinalizedBlock(blockNumber: number): void {
    latestFinalizedBlock = blockNumber;
    latestFinalizedAt = new Date().toISOString();
    rpcAvailable = true;
    const lag = lastProcessedBlock === null ? null : Math.max(0, blockNumber - lastProcessedBlock);
    if (lag !== null && lag > 0 && !catchUpActive) {
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
    lastProcessedBlock = input.blockNumber;
    lastProcessedAt = timestamp;
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
    const endpoint = endpointTotals.get(input.endpointIndex) ?? { attempts: 0, successes: 0, failures: 0, durationMs: 0 };
    endpoint.attempts += 1;
    endpoint.durationMs += input.durationMs;
    if (input.outcome === 'success') endpoint.successes += 1;
    else endpoint.failures += 1;
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
}): void {
    if (input.running !== undefined) scannerRunning = input.running;
    if (input.paused !== undefined) scannerPaused = input.paused;
    if (input.pauseMode !== undefined) pauseMode = input.pauseMode;
    if (input.activeFiltersCount !== undefined) activeFiltersCount = input.activeFiltersCount;
    if (input.lastProcessedBlock !== undefined) lastProcessedBlock = input.lastProcessedBlock;
    if (input.recovery) recoveryMetrics = { ...input.recovery };
    publish();
}

export function getScannerRuntimeMetrics() {
    return getDynamicConfigService().getRuntimeMetricsSnapshot();
}

export function getScannerAnalytics(windowMs = 3600000): ScannerAnalyticsResponse {
    const now = Date.now();
    const since = now - Math.max(60000, Math.min(windowMs, 86400000));
    const selectedBlocks = blockSamples.filter((sample) => sample.timestampMs >= since);
    const selectedRpc = rpcEvents.filter((event) => event.timestampMs >= since);
    const selectedSessions = catchUpSessions.filter((session) => session.startedAtMs >= since);
    const current = getSnapshot();
    const response: ScannerAnalyticsResponse = {
        generatedAt: new Date(now).toISOString(),
        window: String(Math.max(60000, Math.min(windowMs, 86400000))),
        current,
        blockSamples: selectedBlocks.map(({ timestampMs: _timestampMs, ...sample }) => sample),
        rpcEvents: selectedRpc.map(({ timestampMs: _timestampMs, ...event }) => event),
        catchUpSessions: selectedSessions.map(({ startedAtMs: _startedAtMs, ...session }) => session),
    };
    getDynamicConfigService().publishRuntimeAnalytics(response);
    return getDynamicConfigService().getRuntimeAnalyticsSnapshot() as ScannerAnalyticsResponse;
}

export function markScannerStopped(): void {
    scannerRunning = false;
    if (catchUpActive) completeCatchUp('interrupted');
    publish();
}
