import ScannerState from '../models/scannerState';
import {
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
} from '../constants/scanner.constants';
import { shouldPauseBeforeBlock } from './scannerControlService';
import { formatError } from '../utils/formatError';
import { processBlock } from './blockProcessingService';
import { persistProcessedBlockBatch } from './scannerPersistenceService';
import { logBlockProcessed, logCatchUpComplete } from '../utils/scannerLogger';
import { accumulateBlockMetrics, createBlockProcessingTotals } from './scannerMetrics';
import { isScannerLockHeld } from './scannerLockService';

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
            const settledBlocks = await Promise.allSettled(
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
            const failedBlock = settledBlocks.find((result) => result.status === 'rejected');
            if (failedBlock?.status === 'rejected') {
                throw failedBlock.reason;
            }
            const preparedBlocks = settledBlocks.map((result) => {
                if (result.status === 'rejected') throw result.reason;
                return result.value;
            });

            const candidates = preparedBlocks.flatMap(({ result }) => result.candidates);
            if (!(await isScannerLockHeld())) {
                console.warn(
                    `[Scanner] Advisory lock lost before committing batch at block ${currentBatchStart}; yielding to the lock owner`,
                );
                return;
            }

            const databaseWriteStartedAt = Date.now();
            const committedCheckpoint = await persistProcessedBlockBatch(
                candidates,
                preparedBlocks.map(({ result }) => result.block),
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
                    finalizedBlockNumber,
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
