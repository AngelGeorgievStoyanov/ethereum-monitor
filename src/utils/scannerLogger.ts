import { ProcessedBlockMetrics } from '../services/blockProcessingService';

export interface CatchUpSummary {
    startBlock: number;
    endBlock: number;
    processedBlocks: number;
    durationMs: number;
    totalTransactions: number;
    totalNativeMatches: number;
    totalErc20TransferLogsSeen: number;
    totalErc20Matches: number;
    totalErc20FailedAttemptsSeen: number;
    totalErc20FailedAttemptsMatched: number;
    totalFetchDurationMs: number;
    totalBlockDurationMs: number;
    totalNativeDatabaseWriteDurationMs: number;
    totalErc20DatabaseWriteDurationMs: number;
}

export function logBlockProcessed(
    blockNumber: number,
    metrics: ProcessedBlockMetrics,
    blockDurationMs: number,
    checkpoint: number,
): void {
    const databaseWriteDurationMs =
        metrics.nativeDatabaseWriteDurationMs + metrics.erc20DatabaseWriteDurationMs;

    console.log(
        `[Scanner] Block ${blockNumber} processed: tx=${metrics.transactionCount}, ` +
            `native seen=${metrics.nativeTransfersSeen}, native matches=${metrics.nativeMatches}, ` +
            `ERC-20 logs=${metrics.erc20TransferLogsSeen}, ERC-20 matches=${metrics.erc20Matches}, ` +
            `ERC-20 failed attempts=${metrics.erc20FailedAttemptsSeen}, ` +
            `failed matches=${metrics.erc20FailedAttemptsMatched}, ` +
            `fetch=${metrics.fetchDurationMs}ms, db writes=${databaseWriteDurationMs}ms, ` +
            `total=${blockDurationMs}ms, checkpoint=${checkpoint}` +
            (metrics.fetchAttempts > 1 ? `, fetch attempts=${metrics.fetchAttempts}` : ''),
    );
}

export function logCatchUpComplete(summary: CatchUpSummary): void {
    if (summary.processedBlocks === 0) return;

    const blocksPerSecond =
        summary.durationMs > 0
            ? ((summary.processedBlocks * 1000) / summary.durationMs).toFixed(2)
            : 'n/a';
    const averageFetchDurationMs = (summary.totalFetchDurationMs / summary.processedBlocks).toFixed(
        1,
    );
    const averageBlockDurationMs = (summary.totalBlockDurationMs / summary.processedBlocks).toFixed(
        1,
    );
    const totalDatabaseWriteDurationMs =
        summary.totalNativeDatabaseWriteDurationMs + summary.totalErc20DatabaseWriteDurationMs;
    const averageDatabaseWriteDurationMs = (
        totalDatabaseWriteDurationMs / summary.processedBlocks
    ).toFixed(1);

    console.log(
        `[Scanner] Catch-up complete: blocks ${summary.startBlock}-${summary.endBlock}, ` +
            `count=${summary.processedBlocks}, speed=${blocksPerSecond} blocks/s, ` +
            `avg fetch=${averageFetchDurationMs}ms, avg block=${averageBlockDurationMs}ms, ` +
            `avg db writes=${averageDatabaseWriteDurationMs}ms, tx=${summary.totalTransactions}, ` +
            `native matches=${summary.totalNativeMatches}, ` +
            `ERC-20 logs=${summary.totalErc20TransferLogsSeen}, ` +
            `ERC-20 matches=${summary.totalErc20Matches}, ` +
            `ERC-20 failed attempts=${summary.totalErc20FailedAttemptsSeen}, ` +
            `failed attempt matches=${summary.totalErc20FailedAttemptsMatched}, ` +
            `total db writes=${totalDatabaseWriteDurationMs}ms`,
    );
}
