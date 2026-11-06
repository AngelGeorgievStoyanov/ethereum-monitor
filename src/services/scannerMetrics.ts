import type { ProcessedBlockMetrics } from './blockProcessingService';
import {
    getBlockProcessingMetrics as getAggregatedBlockProcessingMetrics,
    recordProcessedBlock,
} from './metricsAggregatorService';

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
    blocksProcessedLast60Seconds: number;
    blocksPerSecondLast60Seconds: number;
    averageBlockDurationLast60SecondsMs: number | null;
    averageFetchDurationLast60SecondsMs: number | null;
    averageDatabaseWriteDurationLast60SecondsMs: number | null;
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
    recordProcessedBlock({
        blockNumber,
        transactionCount: metrics.transactionCount,
        blockDurationMs,
        fetchDurationMs: metrics.fetchDurationMs,
        getBlockDurationMs: metrics.getBlockDurationMs,
        getBlockReceiptsDurationMs: metrics.getBlockReceiptsDurationMs,
        filterMatchingDurationMs: metrics.filterMatchingDurationMs,
        databaseWriteDurationMs: metrics.databaseWriteDurationMs,
        nativeTransfersSeen: metrics.nativeTransfersSeen,
        nativeMatches: metrics.nativeMatches,
        erc20TransferLogsSeen: metrics.erc20TransferLogsSeen,
        erc20Matches: metrics.erc20Matches,
        erc20FailedAttemptsSeen: metrics.erc20FailedAttemptsSeen,
        erc20FailedAttemptsMatched: metrics.erc20FailedAttemptsMatched,
    });
}

export function getBlockProcessingMetrics(): BlockProcessingMetrics {
    return getAggregatedBlockProcessingMetrics();
}
