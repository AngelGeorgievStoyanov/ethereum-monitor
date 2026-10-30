import { ProcessedBlockMetrics } from './blockProcessingService';

export interface BlockProcessingTotals {
    processedBlocks: number;
    totalTransactions: number;
    totalNativeTransfersSeen: number;
    totalNativeMatches: number;
    totalErc20TransferLogsSeen: number;
    totalErc20Matches: number;
    totalErc20FailedAttemptsSeen: number;
    totalErc20FailedAttemptsMatched: number;
    totalFetchDurationMs: number;
    totalGetBlockDurationMs: number;
    totalGetBlockReceiptsDurationMs: number;
    totalFilterMatchingDurationMs: number;
    totalBlockDurationMs: number;
    totalDatabaseWriteDurationMs: number;
}

export interface RecentBlockMetric {
    blockNumber: number;
    processedAt: string;
    blockDurationMs: number;
    fetchDurationMs: number;
    filterMatchingDurationMs: number;
    databaseWriteDurationMs: number;
    nativeTransfersSeen: number;
    nativeMatches: number;
    erc20TransferLogsSeen: number;
    erc20Matches: number;
}

export interface BlockProcessingMetrics extends BlockProcessingTotals {
    lastProcessedBlock: number | null;
    lastProcessedAt: string | null;
    lastBlockDurationMs: number | null;
    blocksProcessedLastMinute: number;
    blocksPerSecondLastMinute: number;
    averageBlockDurationLastMinuteMs: number | null;
    averageFetchDurationLastMinuteMs: number | null;
    averageDatabaseWriteDurationLastMinuteMs: number | null;
    recentBlocks: RecentBlockMetric[];
}

export function createBlockProcessingTotals(): BlockProcessingTotals {
    return {
        processedBlocks: 0,
        totalTransactions: 0,
        totalNativeTransfersSeen: 0,
        totalNativeMatches: 0,
        totalErc20TransferLogsSeen: 0,
        totalErc20Matches: 0,
        totalErc20FailedAttemptsSeen: 0,
        totalErc20FailedAttemptsMatched: 0,
        totalFetchDurationMs: 0,
        totalGetBlockDurationMs: 0,
        totalGetBlockReceiptsDurationMs: 0,
        totalFilterMatchingDurationMs: 0,
        totalBlockDurationMs: 0,
        totalDatabaseWriteDurationMs: 0,
    };
}

const processTotals = createBlockProcessingTotals();
const recentBlocks: Array<RecentBlockMetric & { timestamp: number }> = [];
let lastProcessedBlock: number | null = null;
let lastProcessedAt: string | null = null;
let lastBlockDurationMs: number | null = null;

function addMetrics(
    totals: BlockProcessingTotals,
    metrics: ProcessedBlockMetrics,
    blockDurationMs: number,
): void {
    totals.totalTransactions += metrics.transactionCount;
    totals.totalNativeTransfersSeen += metrics.nativeTransfersSeen;
    totals.totalNativeMatches += metrics.nativeMatches;
    totals.totalErc20TransferLogsSeen += metrics.erc20TransferLogsSeen;
    totals.totalErc20Matches += metrics.erc20Matches;
    totals.totalErc20FailedAttemptsSeen += metrics.erc20FailedAttemptsSeen;
    totals.totalErc20FailedAttemptsMatched += metrics.erc20FailedAttemptsMatched;
    totals.totalFetchDurationMs += metrics.fetchDurationMs;
    totals.totalGetBlockDurationMs += metrics.getBlockDurationMs;
    totals.totalGetBlockReceiptsDurationMs += metrics.getBlockReceiptsDurationMs;
    totals.totalFilterMatchingDurationMs += metrics.filterMatchingDurationMs;
    totals.totalBlockDurationMs += blockDurationMs;
    totals.totalDatabaseWriteDurationMs += metrics.databaseWriteDurationMs;
    totals.processedBlocks += 1;
}

export function accumulateBlockMetrics(
    totals: BlockProcessingTotals,
    metrics: ProcessedBlockMetrics,
    blockDurationMs: number,
    blockNumber: number,
): void {
    addMetrics(totals, metrics, blockDurationMs);
    addMetrics(processTotals, metrics, blockDurationMs);

    const timestamp = Date.now();
    const processedAt = new Date(timestamp).toISOString();
    lastProcessedBlock = blockNumber;
    lastProcessedAt = processedAt;
    lastBlockDurationMs = blockDurationMs;

    recentBlocks.push({
        timestamp,
        processedAt,
        blockNumber,
        blockDurationMs,
        fetchDurationMs: metrics.fetchDurationMs,
        filterMatchingDurationMs: metrics.filterMatchingDurationMs,
        databaseWriteDurationMs: metrics.databaseWriteDurationMs,
        nativeTransfersSeen: metrics.nativeTransfersSeen,
        nativeMatches: metrics.nativeMatches,
        erc20TransferLogsSeen: metrics.erc20TransferLogsSeen,
        erc20Matches: metrics.erc20Matches,
    });

    const cutoff = timestamp - 60000;
    while (recentBlocks.length > 0 && recentBlocks[0].timestamp < cutoff) {
        recentBlocks.shift();
    }
}

export function getBlockProcessingMetrics(): BlockProcessingMetrics {
    const cutoff = Date.now() - 60000;
    while (recentBlocks.length > 0 && recentBlocks[0].timestamp < cutoff) {
        recentBlocks.shift();
    }

    const recentCount = recentBlocks.length;
    const recentTotal = (selector: (block: RecentBlockMetric) => number): number =>
        recentBlocks.reduce((total, block) => total + selector(block), 0);
    const average = (total: number): number | null =>
        recentCount > 0 ? Number((total / recentCount).toFixed(1)) : null;

    return {
        ...processTotals,
        lastProcessedBlock,
        lastProcessedAt,
        lastBlockDurationMs,
        blocksProcessedLastMinute: recentCount,
        blocksPerSecondLastMinute: Number((recentCount / 60).toFixed(2)),
        averageBlockDurationLastMinuteMs: average(recentTotal((block) => block.blockDurationMs)),
        averageFetchDurationLastMinuteMs: average(recentTotal((block) => block.fetchDurationMs)),
        averageDatabaseWriteDurationLastMinuteMs: average(
            recentTotal((block) => block.databaseWriteDurationMs),
        ),
        recentBlocks: recentBlocks.slice(-30).map(({ timestamp: _timestamp, ...block }) => ({
            ...block,
        })),
    };
}
