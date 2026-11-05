import type { ScannerState } from '../types/scanner-state.types';
import type { ActiveTxFilterConfig } from '../types/tx-filter.types';
import {
    REORG_RECOVERY_STABLE_BLOCKS,
    SCANNER_MAX_PARALLEL_BLOCKS,
    SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS,
} from '../constants/scanner.constants';
import { getDynamicConfigService } from './dynamicConfigService';
import { formatError } from '../utils/formatError';
import { fetchBlockForProcessing, processFetchedBlock } from './blockProcessingService';
import { BlockReceiptConsistencyError } from './evmBlockDataService';
import { markReorgRecoveryPending } from './reorgRecoveryService';
import { recordReorgDetected } from './recoveryMetrics';
import { persistProcessedBlockBatch } from './scannerPersistenceService';
import type { CanonicalBlockIdentity } from '../repositories/blockRepository';
import {
    cacheConfirmedCheckpointBlock,
    getConfirmedCheckpointBlock,
    invalidateConfirmedBlockCache,
} from './scannerCheckpointCache';
import { logBlockProcessed, logCatchUpComplete } from '../utils/scannerLogger';
import { accumulateBlockMetrics, createBlockProcessingTotals } from './scannerMetrics';
import { BlockChainDiscontinuityError } from '../errors/blockChainDiscontinuityError';
import { recordProcessingBatch } from './metricsAggregatorService';

type ConfirmedBlock = CanonicalBlockIdentity;

let lastLoggedFilterConfigVersion = '';

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
    getActiveTxFilters: () => ActiveTxFilterConfig,
): Promise<void> {
    const catchupStartedAt = Date.now();
    const catchupStartBlock = state.lastProcessedBlock + 1;
    const totals = createBlockProcessingTotals();
    let currentBatchStart: number | undefined;

    while (state.lastProcessedBlock < finalizedBlockNumber) {
        currentBatchStart = state.lastProcessedBlock + 1;
        const batchStartedAt = Date.now();
        if (getDynamicConfigService().getScannerPaused()) return;
        const filterConfig = getActiveTxFilters();
        const activeTxFilters = filterConfig.filters;
        if (activeTxFilters.length === 0) return;

        const dynamicSettings = getDynamicConfigService().getDynamicSettings();
        const parallelProcessingLagBlocks =
            Number(dynamicSettings.parallelProcessingLagBlocks) ||
            SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS;
        const maxParallelBlocks =
            Number(dynamicSettings.maxParallelBlocks) || SCANNER_MAX_PARALLEL_BLOCKS;
        const lag = finalizedBlockNumber - state.lastProcessedBlock;
        const batchSize = lag > parallelProcessingLagBlocks ? maxParallelBlocks : 1;
        const blockNumbers = Array.from(
            { length: Math.min(batchSize, finalizedBlockNumber - state.lastProcessedBlock) },
            (_, index) => currentBatchStart! + index,
        );
        const expectedCheckpoint = state.lastProcessedBlock;
        if (filterConfig.version !== lastLoggedFilterConfigVersion) {
            console.log(
                `[Scanner] First batch using transaction filter config version=${filterConfig.version}; blocks=${blockNumbers[0]}-${blockNumbers[blockNumbers.length - 1]}; filters=${activeTxFilters.length}`,
            );
            lastLoggedFilterConfigVersion = filterConfig.version;
        }

        try {
            const previousConfirmedBlock = await getConfirmedCheckpointBlock(expectedCheckpoint);
            const fetchStageStartedAt = Date.now();
            let activeFetches = 0;
            let maxConcurrentFetches = 0;
            const fetchedSettledBlocks = await Promise.allSettled(
                blockNumbers.map(async (blockNumber) => {
                    activeFetches += 1;
                    maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);
                    try {
                        return {
                            blockNumber,
                            fetched: await fetchBlockForProcessing(blockNumber),
                        };
                    } finally {
                        activeFetches -= 1;
                    }
                }),
            );
            const fetchStageDurationMs = Date.now() - fetchStageStartedAt;
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

            const processingStageStartedAt = Date.now();
            let activeProcessing = 0;
            let maxConcurrentProcessing = 0;
            const settledBlocks = await Promise.allSettled(
                fetchedBlocks.map(async ({ blockNumber, fetched }) => {
                    activeProcessing += 1;
                    maxConcurrentProcessing = Math.max(maxConcurrentProcessing, activeProcessing);
                    try {
                        return {
                            blockNumber,
                            result: await processFetchedBlock(fetched, activeTxFilters, false),
                        };
                    } finally {
                        activeProcessing -= 1;
                    }
                }),
            );
            const processingStageDurationMs = Date.now() - processingStageStartedAt;
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
            const databaseWriteStartedAt = Date.now();
            const committedCheckpoint = await persistProcessedBlockBatch({
                candidates,
                blocks: processedBlockRecords,
                scannerStateId: state.id,
                expectedCheckpoint,
                newCheckpoint: blockNumbers[blockNumbers.length - 1],
            });
            const databaseWriteDurationMs = Date.now() - databaseWriteStartedAt;

            if (committedCheckpoint !== blockNumbers[blockNumbers.length - 1]) {
                state.lastProcessedBlock = committedCheckpoint;
                // The checkpoint changed; never keep a cache for a different range.
                invalidateConfirmedBlockCache();
                continue;
            }

            state.lastProcessedBlock = committedCheckpoint;
            // Advance the in-memory checkpoint only after the DB transaction has committed.
            cacheConfirmedCheckpointBlock(
                processedBlockRecords[processedBlockRecords.length - 1] ?? null,
                committedCheckpoint,
            );
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
                accumulateBlockMetrics(totals, result, blockDurationMs, blockNumber);
            }
            recordProcessingBatch({
                startBlock: blockNumbers[0],
                endBlock: blockNumbers[blockNumbers.length - 1],
                blocks: preparedBlocks.length,
                transactions: preparedBlocks.reduce(
                    (total, item) => total + item.result.transactionCount,
                    0,
                ),
                durationMs: Date.now() - batchStartedAt,
                databaseWriteDurationMs,
                fetchStageDurationMs,
                processingStageDurationMs,
                persistenceStageDurationMs: databaseWriteDurationMs,
                configuredMaxParallelBlocks: maxParallelBlocks,
                parallelProcessingLagBlocks,
                lagAtBatchStart: lag,
                maxConcurrentFetches,
                maxConcurrentProcessing,
            });
        } catch (error) {
            console.error(
                `[Scanner] Processing failed at block ${currentBatchStart}; checkpoint=${state.lastProcessedBlock}: ${formatError(error)}`,
            );
            if (
                error instanceof BlockReceiptConsistencyError ||
                error instanceof BlockChainDiscontinuityError
            ) {
                recordReorgDetected();
                try {
                    await markReorgRecoveryPending(
                        state.id,
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
