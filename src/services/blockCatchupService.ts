import ScannerState from '../models/scannerState';
import TxFilter from '../models/txFilter';
import { updateScannerCheckpoint } from '../repositories/scannerStateRepository';
import { formatError } from '../utils/formatError';
import { processBlock } from './blockProcessingService';

export async function catchUpToFinalizedBlock(
    state: ScannerState,
    finalizedBlockNumber: number,
    activeTxFilters: TxFilter[],
): Promise<void> {
    const catchupStartedAt = Date.now();
    const catchupStartBlock = state.lastProcessedBlock + 1;
    let processedBlocks = 0;
    let totalTransactions = 0;
    let totalNativeMatches = 0;
    let totalErc20TransferLogsSeen = 0;
    let totalErc20Matches = 0;
    let totalErc20FailedAttemptsSeen = 0;
    let totalErc20FailedAttemptsMatched = 0;
    let totalFetchDurationMs = 0;
    let totalBlockDurationMs = 0;
    let totalNativeDatabaseWriteDurationMs = 0;
    let totalErc20DatabaseWriteDurationMs = 0;

    while (state.lastProcessedBlock < finalizedBlockNumber) {
        const blockNumber = state.lastProcessedBlock + 1;

        try {
            const metrics = await processBlock(blockNumber, activeTxFilters);
            const checkpointStartedAt = Date.now();
            await updateScannerCheckpoint(state.id, blockNumber);
            const blockDurationMs = metrics.blockDurationMs + Date.now() - checkpointStartedAt;
            state.lastProcessedBlock = blockNumber;

            const databaseWriteDurationMs =
                metrics.nativeDatabaseWriteDurationMs + metrics.erc20DatabaseWriteDurationMs;
            console.log(
                `[Scanner] Block ${blockNumber} processed: tx=${metrics.transactionCount}, ` +
                    `native seen=${metrics.nativeTransfersSeen}, ` +
                    `native matches=${metrics.nativeMatches}, ` +
                    `ERC-20 logs=${metrics.erc20TransferLogsSeen}, ` +
                    `ERC-20 matches=${metrics.erc20Matches}, ` +
                    `ERC-20 failed attempts=${metrics.erc20FailedAttemptsSeen}, ` +
                    `failed matches=${metrics.erc20FailedAttemptsMatched}, ` +
                    `fetch=${metrics.fetchDurationMs}ms, db writes=${databaseWriteDurationMs}ms, ` +
                    `total=${blockDurationMs}ms, checkpoint=${state.lastProcessedBlock}` +
                    (metrics.fetchAttempts > 1 ? `, fetch attempts=${metrics.fetchAttempts}` : ''),
            );

            totalTransactions += metrics.transactionCount;
            totalNativeMatches += metrics.nativeMatches;
            totalErc20TransferLogsSeen += metrics.erc20TransferLogsSeen;
            totalErc20Matches += metrics.erc20Matches;
            totalErc20FailedAttemptsSeen += metrics.erc20FailedAttemptsSeen;
            totalErc20FailedAttemptsMatched += metrics.erc20FailedAttemptsMatched;
            totalFetchDurationMs += metrics.fetchDurationMs;
            totalBlockDurationMs += blockDurationMs;
            totalNativeDatabaseWriteDurationMs += metrics.nativeDatabaseWriteDurationMs;
            totalErc20DatabaseWriteDurationMs += metrics.erc20DatabaseWriteDurationMs;
            processedBlocks += 1;
        } catch (error) {
            console.error(
                `[Scanner] Processing failed at block ${blockNumber}; ` +
                    `checkpoint=${state.lastProcessedBlock}: ${formatError(error)}`,
            );
            return;
        }
    }

    if (processedBlocks === 0) return;

    const durationMs = Date.now() - catchupStartedAt;
    const blocksPerSecond =
        durationMs > 0 ? ((processedBlocks * 1000) / durationMs).toFixed(2) : 'n/a';
    const averageFetchDurationMs = (totalFetchDurationMs / processedBlocks).toFixed(1);
    const averageBlockDurationMs = (totalBlockDurationMs / processedBlocks).toFixed(1);
    const totalDatabaseWriteDurationMs =
        totalNativeDatabaseWriteDurationMs + totalErc20DatabaseWriteDurationMs;
    const averageDatabaseWriteDurationMs = (
        totalDatabaseWriteDurationMs / processedBlocks
    ).toFixed(1);

    console.log(
        `[Scanner] Catch-up complete: blocks ${catchupStartBlock}-${state.lastProcessedBlock}, ` +
            `count=${processedBlocks}, speed=${blocksPerSecond} blocks/s, ` +
            `avg fetch=${averageFetchDurationMs}ms, avg block=${averageBlockDurationMs}ms, ` +
            `avg db writes=${averageDatabaseWriteDurationMs}ms, tx=${totalTransactions}, ` +
            `native matches=${totalNativeMatches}, ERC-20 logs=${totalErc20TransferLogsSeen}, ` +
            `ERC-20 matches=${totalErc20Matches}, ` +
            `ERC-20 failed attempts=${totalErc20FailedAttemptsSeen}, ` +
            `failed attempt matches=${totalErc20FailedAttemptsMatched}, ` +
            `total db writes=${totalDatabaseWriteDurationMs}ms`,
    );
}
