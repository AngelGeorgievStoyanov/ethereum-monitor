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
    totalDatabaseWriteDurationMs: number;
}

export function logBlockProcessed(
    blockNumber: number,
    metrics: ProcessedBlockMetrics,
    blockDurationMs: number,
    checkpoint: number,
    finalizedBlockNumber: number,
): void {
    const databaseWriteDurationMs = metrics.databaseWriteDurationMs;
    const finalizedLag = Math.max(0, finalizedBlockNumber - checkpoint);

    console.log(
        `[Scanner] Block ${blockNumber} processed: tx=${metrics.transactionCount}, ` +
            `native seen=${metrics.nativeTransfersSeen}, native matches=${metrics.nativeMatches}, ` +
            `ERC-20 logs=${metrics.erc20TransferLogsSeen}, ERC-20 matches=${metrics.erc20Matches}, ` +
            `ERC-20 failed attempts=${metrics.erc20FailedAttemptsSeen}, ` +
            `failed matches=${metrics.erc20FailedAttemptsMatched}, ` +
            `getBlock=${metrics.getBlockDurationMs}ms, ` +
            `getBlockReceipts=${metrics.getBlockReceiptsDurationMs}ms, ` +
            `fetch total=${metrics.fetchDurationMs}ms, ` +
            `filter matching=${metrics.filterMatchingDurationMs}ms, ` +
            `db writes=${databaseWriteDurationMs}ms, total=${blockDurationMs}ms, ` +
            `checkpoint=${checkpoint}, finalized lag=${finalizedLag} blocks` +
            (metrics.fetchAttempts > 1 ? `, fetch attempts=${metrics.fetchAttempts}` : ''),
    );
}

export function logCatchUpComplete(summary: CatchUpSummary): void {
    if (summary.processedBlocks === 0) return;

    const blocksPerSecond =
        summary.durationMs > 0
            ? ((summary.processedBlocks * 1000) / summary.durationMs).toFixed(2)
            : 'n/a';
    const blocksPerMinute =
        summary.durationMs > 0
            ? ((summary.processedBlocks * 60000) / summary.durationMs).toFixed(1)
            : 'n/a';
    const averageFetchDurationMs = (summary.totalFetchDurationMs / summary.processedBlocks).toFixed(
        1,
    );
    const averageBlockDurationMs = (summary.totalBlockDurationMs / summary.processedBlocks).toFixed(
        1,
    );
    const averageDatabaseWriteDurationMs = (
        summary.totalDatabaseWriteDurationMs / summary.processedBlocks
    ).toFixed(1);

    console.log(
        `[Scanner] Catch-up complete: blocks ${summary.startBlock}-${summary.endBlock}, ` +
            `count=${summary.processedBlocks}, speed=${blocksPerSecond} blocks/s (${blocksPerMinute} blocks/min), ` +
            `avg fetch=${averageFetchDurationMs}ms, avg block=${averageBlockDurationMs}ms, ` +
            `avg db writes=${averageDatabaseWriteDurationMs}ms, tx=${summary.totalTransactions}, ` +
            `native matches=${summary.totalNativeMatches}, ` +
            `ERC-20 logs=${summary.totalErc20TransferLogsSeen}, ` +
            `ERC-20 matches=${summary.totalErc20Matches}, ` +
            `ERC-20 failed attempts=${summary.totalErc20FailedAttemptsSeen}, ` +
            `failed attempt matches=${summary.totalErc20FailedAttemptsMatched}, ` +
            `total db writes=${summary.totalDatabaseWriteDurationMs}ms`,
    );
}
