import ScannerState from '../models/scannerState';
import {
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
} from '../constants/scanner.constants';
import { shouldPauseBeforeBlock } from './scannerControlService';
import { formatError } from '../utils/formatError';
import { processBlock } from './blockProcessingService';
import { persistProcessedBlockBatch } from './transactionService';
import { logBlockProcessed, logCatchUpComplete } from '../utils/scannerLogger';
import { accumulateBlockMetrics, createBlockProcessingTotals } from './scannerMetrics';

export async function processFinalizedBlocks(
    state: ScannerState,
    finalizedBlockNumber: number,
    getActiveTxFilters: () => import('./txFilterEvaluatorService').ActiveTxFilter[],
): Promise<void> {
    const catchupStartedAt = Date.now();
    const catchupStartBlock = state.lastProcessedBlock + 1;
    if (shouldPauseBeforeBlock(catchupStartBlock, state.lastProcessedBlock)) return;

    const totals = createBlockProcessingTotals();
    let currentBatchStart: number | undefined;

    while (state.lastProcessedBlock < finalizedBlockNumber) {
        currentBatchStart = state.lastProcessedBlock + 1;
        if (shouldPauseBeforeBlock(currentBatchStart, state.lastProcessedBlock)) return;
        const activeTxFilters = getActiveTxFilters();
        if (activeTxFilters.length === 0) return;

        const lag = finalizedBlockNumber - state.lastProcessedBlock;
        const batchSize =
            lag > SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS ? SCANNER_MAX_PARALLEL_BLOCKS : 1;
        const blockNumbers = Array.from(
            { length: Math.min(batchSize, finalizedBlockNumber - state.lastProcessedBlock) },
            (_, index) => currentBatchStart! + index,
        );
        const expectedCheckpoint = state.lastProcessedBlock;

        try {
            const preparedBlocks = await Promise.all(
                blockNumbers.map(async (blockNumber) => {
                    try {
                        return {
                            blockNumber,
                            result: await processBlock(blockNumber, activeTxFilters),
                        };
                    } catch (error) {
                        throw new Error(
                            `Block ${blockNumber} failed: ${formatError(error)}`,
                        );
                    }
                }),
            );

            const candidates = preparedBlocks.flatMap(({ result }) => result.candidates);
            const databaseWriteStartedAt = Date.now();
            const committedCheckpoint = await persistProcessedBlockBatch(
                candidates,
                state.id,
                expectedCheckpoint,
                blockNumbers[blockNumbers.length - 1],
            );
            const databaseWriteDurationMs = Date.now() - databaseWriteStartedAt;

            if (committedCheckpoint !== blockNumbers[blockNumbers.length - 1]) {
                state.lastProcessedBlock = committedCheckpoint;
                continue;
            }

            state.lastProcessedBlock = committedCheckpoint;
            const perBlockDatabaseWriteDurationMs = Math.ceil(
                databaseWriteDurationMs / preparedBlocks.length,
            );

            for (const { blockNumber, result } of preparedBlocks) {
                result.databaseWriteDurationMs = perBlockDatabaseWriteDurationMs;
                const blockDurationMs = result.blockDurationMs + perBlockDatabaseWriteDurationMs;
                logBlockProcessed(
                    blockNumber,
                    result,
                    blockDurationMs,
                    state.lastProcessedBlock,
                );
                accumulateBlockMetrics(totals, result, blockDurationMs);
            }
        } catch (error) {
            console.error(
                `[Scanner] Processing failed at block ${currentBatchStart}; checkpoint=${state.lastProcessedBlock}: ${formatError(error)}`,
            );
            return;
        }
    }

    logCatchUpComplete({
        startBlock: catchupStartBlock,
        endBlock: state.lastProcessedBlock,
        durationMs: Date.now() - catchupStartedAt,
        ...totals,
    });
}
