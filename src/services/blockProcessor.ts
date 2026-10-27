import ScannerState from '../models/scannerState';
import Block from '../models/block';
import {
    REORG_RECOVERY_STABLE_BLOCKS,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
} from '../constants/scanner.constants';
import { shouldPauseBeforeBlock } from './scannerControlService';
import { formatError } from '../utils/formatError';
import { fetchBlockForProcessing, processFetchedBlock } from './blockProcessingService';
import { BlockReceiptConsistencyError } from './ethereumRpcService';
import { markReorgRecoveryPending } from './reorgRecoveryService';
import { recordReorgDetected } from './recoveryMetrics';
import { persistProcessedBlockBatch } from './scannerPersistenceService';
import { logBlockProcessed, logCatchUpComplete } from '../utils/scannerLogger';
import { accumulateBlockMetrics, createBlockProcessingTotals } from './scannerMetrics';
import { isScannerLockHeld } from './scannerLockService';

type ConfirmedBlock = { blockNumber: number; blockHash: string; parentHash: string };

let lastConfirmedBlock: ConfirmedBlock | null = null;

async function getConfirmedCheckpointBlock(checkpoint: number): Promise<ConfirmedBlock | null> {
    if (checkpoint < 0) return null;

    if (lastConfirmedBlock?.blockNumber === checkpoint) {
        return lastConfirmedBlock;
    }

    const persistedBlock = await Block.findOne({
        where: { blockNumber: checkpoint, status: 'CANONICAL' },
        attributes: ['blockNumber', 'blockHash', 'parentHash'],
    });

    if (persistedBlock) {
        lastConfirmedBlock = {
            blockNumber: persistedBlock.blockNumber,
            blockHash: persistedBlock.blockHash,
            parentHash: persistedBlock.parentHash,
        };
        return lastConfirmedBlock;
    }

    // A fresh checkpoint without a persisted block has no trusted in-memory hash yet.
    // Do not issue an extra RPC call solely to seed the connectivity check.
    lastConfirmedBlock = null;
    return null;
}

export function invalidateConfirmedBlockCache(): void {
    lastConfirmedBlock = null;
}

class BlockChainDiscontinuityError extends Error {
    constructor(
        public readonly blockNumber: number,
        message: string,
    ) {
        super(message);
        this.name = 'BlockChainDiscontinuityError';
    }
}

function validateBatchConnectivity(
    previousBlock: ConfirmedBlock | null,
    headers: readonly ConfirmedBlock[],
    expectedBlockNumbers: readonly number[],
): void {
    for (let index = 0; index < headers.length; index += 1) {
        const current = headers[index];
        if (current.blockNumber !== expectedBlockNumbers[index]) {
            throw new BlockChainDiscontinuityError(
                expectedBlockNumbers[index],
                `RPC returned block ${current.blockNumber} when block ${expectedBlockNumbers[index]} was requested`,
            );
        }
        const previous = index === 0 ? previousBlock : headers[index - 1];
        if (previous && current.parentHash.toLowerCase() !== previous.blockHash.toLowerCase()) {
            throw new BlockChainDiscontinuityError(
                current.blockNumber,
                `Block chain discontinuity between ${previous.blockNumber} and ${current.blockNumber}; reorg recovery is required`,
            );
        }
    }
}

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
            const previousConfirmedBlock = await getConfirmedCheckpointBlock(expectedCheckpoint);
            const fetchedSettledBlocks = await Promise.allSettled(
                blockNumbers.map(async (blockNumber) => ({
                    blockNumber,
                    fetched: await fetchBlockForProcessing(blockNumber),
                })),
            );
            const failedFetch = fetchedSettledBlocks.find((result) => result.status === 'rejected');
            if (failedFetch?.status === 'rejected') {
                throw failedFetch.reason;
            }
            const fetchedBlocks = fetchedSettledBlocks.map((result) => {
                if (result.status === 'rejected') throw result.reason;
                return result.value;
            });

            const fetchedBlockRecords = fetchedBlocks.map(({ fetched }) => ({
                blockNumber: fetched.block.number,
                blockHash: fetched.block.hash,
                parentHash: fetched.block.parentHash,
            }));
            validateBatchConnectivity(previousConfirmedBlock, fetchedBlockRecords, blockNumbers);

            const settledBlocks = await Promise.allSettled(
                fetchedBlocks.map(async ({ blockNumber, fetched }) => ({
                    blockNumber,
                    result: await processFetchedBlock(fetched, activeTxFilters, false),
                })),
            );
            const failedBlock = settledBlocks.find((result) => result.status === 'rejected');
            if (failedBlock?.status === 'rejected') {
                throw failedBlock.reason;
            }
            const preparedBlocks = settledBlocks.map((result) => {
                if (result.status === 'rejected') throw result.reason;
                return result.value;
            });

            const processedBlockRecords = preparedBlocks.map(({ result }) => result.block);
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
                processedBlockRecords,
                state.id,
                expectedCheckpoint,
                blockNumbers[blockNumbers.length - 1],
            );
            const databaseWriteDurationMs = Date.now() - databaseWriteStartedAt;

            if (committedCheckpoint !== blockNumbers[blockNumbers.length - 1]) {
                state.lastProcessedBlock = committedCheckpoint;
                // Another replica changed the checkpoint; never keep a cache for a different range.
                lastConfirmedBlock = null;
                continue;
            }

            state.lastProcessedBlock = committedCheckpoint;
            // Advance the in-memory checkpoint only after the DB transaction has committed.
            lastConfirmedBlock = processedBlockRecords[processedBlockRecords.length - 1] ?? null;
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
            if (error instanceof BlockReceiptConsistencyError || error instanceof BlockChainDiscontinuityError) {
                recordReorgDetected();
                try {
                    await markReorgRecoveryPending(
                        state,
                        state.lastProcessedBlock,
                        error.blockNumber + REORG_RECOVERY_STABLE_BLOCKS,
                    );
                    console.warn(
                        `[Reorg] Block/receipt consistency failure at block ${error.blockNumber}; recovery scheduled from checkpoint ${state.lastProcessedBlock}`,
                    );
                } catch (recoveryError) {
                    console.error(
                        `[Reorg] Failed to schedule recovery after consistency failure: ${formatError(recoveryError)}`,
                    );
                }
            }
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
