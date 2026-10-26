import { ProcessedBlockMetrics } from './blockProcessingService';

export interface BlockProcessingTotals {
    processedBlocks: number;
    totalTransactions: number;
    totalNativeMatches: number;
    totalErc20TransferLogsSeen: number;
    totalErc20Matches: number;
    totalErc20FailedAttemptsSeen: number;
    totalErc20FailedAttemptsMatched: number;
    totalFetchDurationMs: number;
    totalBlockDurationMs: number;
    totalDatabaseWriteDurationMs: number;
}

export function createBlockProcessingTotals(): BlockProcessingTotals {
    return {
        processedBlocks: 0,
        totalTransactions: 0,
        totalNativeMatches: 0,
        totalErc20TransferLogsSeen: 0,
        totalErc20Matches: 0,
        totalErc20FailedAttemptsSeen: 0,
        totalErc20FailedAttemptsMatched: 0,
        totalFetchDurationMs: 0,
        totalBlockDurationMs: 0,
        totalDatabaseWriteDurationMs: 0,
    };
}

export function accumulateBlockMetrics(
    totals: BlockProcessingTotals,
    metrics: ProcessedBlockMetrics,
    blockDurationMs: number,
): void {
    totals.totalTransactions += metrics.transactionCount;
    totals.totalNativeMatches += metrics.nativeMatches;
    totals.totalErc20TransferLogsSeen += metrics.erc20TransferLogsSeen;
    totals.totalErc20Matches += metrics.erc20Matches;
    totals.totalErc20FailedAttemptsSeen += metrics.erc20FailedAttemptsSeen;
    totals.totalErc20FailedAttemptsMatched += metrics.erc20FailedAttemptsMatched;
    totals.totalFetchDurationMs += metrics.fetchDurationMs;
    totals.totalBlockDurationMs += blockDurationMs;
    totals.totalDatabaseWriteDurationMs += metrics.databaseWriteDurationMs;
    totals.processedBlocks += 1;
}
