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
type PreparedBlock = {
    blockNumber: number;
    result: Awaited<ReturnType<typeof processFetchedBlock>>;
};

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
    finalizedCatchupTarget: number,
    actualFinalizedBlockNumber: number,
    maxBlocksPerCatchup: number,
    getActiveTxFilters: () => ActiveTxFilterConfig,
): Promise<void> {
    const dynamicSettings = getDynamicConfigService().getDynamicSettings();
    const parallelProcessingLagBlocks =
        Number(dynamicSettings.parallelProcessingLagBlocks) ||
        SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS;
    const maxParallelBlocks = Math.max(
        1,
        Math.floor(Number(dynamicSettings.maxParallelBlocks) || SCANNER_MAX_PARALLEL_BLOCKS),
    );
    const lag = actualFinalizedBlockNumber - state.lastProcessedBlock;
    const configuredConcurrency = lag > parallelProcessingLagBlocks ? maxParallelBlocks : 1;
    // Bound the ordered result buffer to two worker windows while workers refill slots.
    const rollingWindowSize = configuredConcurrency > 1 ? configuredConcurrency * 2 : 1;

    const catchupStartedAt = Date.now();
    const catchupStartBlock = state.lastProcessedBlock + 1;
    const totals = createBlockProcessingTotals();
    let blocksProcessedThisCatchup = 0;
    let currentBatchStart: number | undefined;

    while (
        state.lastProcessedBlock < finalizedCatchupTarget &&
        blocksProcessedThisCatchup < maxBlocksPerCatchup
    ) {
        currentBatchStart = state.lastProcessedBlock + 1;
        const batchStartedAt = Date.now();
        if (getDynamicConfigService().getScannerPaused()) return;

        const filterConfig = getActiveTxFilters();
        const activeTxFilters = filterConfig.filters;
        if (activeTxFilters.length === 0) return;

        const expectedCheckpoint = state.lastProcessedBlock;
        const windowLength = Math.min(
            rollingWindowSize,
            finalizedCatchupTarget - state.lastProcessedBlock,
            maxBlocksPerCatchup - blocksProcessedThisCatchup,
        );
        const blockNumbers = Array.from(
            { length: windowLength },
            (_, index) => currentBatchStart! + index,
        );
        const workerCount = Math.min(configuredConcurrency, blockNumbers.length);

        if (filterConfig.version !== lastLoggedFilterConfigVersion) {
            console.log(
                `[Scanner] First rolling window using transaction filter config version=${filterConfig.version}; blocks=${blockNumbers[0]}-${blockNumbers[blockNumbers.length - 1]}; filters=${activeTxFilters.length}`,
            );
            lastLoggedFilterConfigVersion = filterConfig.version;
        }

        try {
            const previousConfirmedBlock = await getConfirmedCheckpointBlock(expectedCheckpoint);
            const fetchStartedAt: number[] = [];
            const fetchFinishedAt: number[] = [];
            const processingStartedAt: number[] = [];
            const processingFinishedAt: number[] = [];
            let nextBlockIndex = 0;
            let stopScheduling = false;
            const workerErrors: Array<{ index: number; error: unknown }> = [];

            let activeFetches = 0;
            let maxConcurrentFetches = 0;
            let noFetchDurationMs = 0;
            let noFetchStartedAt = Date.now();
            let totalConcurrentFetchMs = 0;
            let lastFetchConcurrencyChangeAt = 0;
            const updateFetchConcurrency = (nextActiveFetches: number) => {
                const now = Date.now();
                if (activeFetches === 0 && nextActiveFetches > 0) {
                    noFetchDurationMs += now - noFetchStartedAt;
                } else if (activeFetches > 0 && nextActiveFetches === 0) {
                    noFetchStartedAt = now;
                }
                if (lastFetchConcurrencyChangeAt > 0) {
                    totalConcurrentFetchMs += activeFetches * (now - lastFetchConcurrencyChangeAt);
                }
                activeFetches = nextActiveFetches;
                lastFetchConcurrencyChangeAt = now;
            };

            let activeProcessing = 0;
            let maxConcurrentProcessing = 0;
            const preparedBlocks: Array<PreparedBlock | undefined> = new Array(blockNumbers.length);

            const workers = Array.from({ length: workerCount }, async () => {
                while (!stopScheduling) {
                    const index = nextBlockIndex;
                    nextBlockIndex += 1;
                    if (index >= blockNumbers.length) return;

                    const blockNumber = blockNumbers[index];
                    try {
                        const fetchStarted = Date.now();
                        fetchStartedAt[index] = fetchStarted;
                        updateFetchConcurrency(activeFetches + 1);
                        maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);
                        let fetched: Awaited<ReturnType<typeof fetchBlockForProcessing>>;
                        try {
                            fetched = await fetchBlockForProcessing(blockNumber);
                        } finally {
                            fetchFinishedAt[index] = Date.now();
                            updateFetchConcurrency(activeFetches - 1);
                        }

                        const processingStarted = Date.now();
                        processingStartedAt[index] = processingStarted;
                        activeProcessing += 1;
                        maxConcurrentProcessing = Math.max(
                            maxConcurrentProcessing,
                            activeProcessing,
                        );
                        try {
                            const result = await processFetchedBlock(
                                fetched,
                                activeTxFilters,
                                false,
                            );
                            preparedBlocks[index] = { blockNumber, result };
                        } finally {
                            processingFinishedAt[index] = Date.now();
                            activeProcessing -= 1;
                        }
                    } catch (error) {
                        workerErrors.push({ index, error });
                        stopScheduling = true;
                        return;
                    }
                }
            });

            // Workers catch task failures themselves; awaiting all workers drains every in-flight task.
            await Promise.all(workers);
            if (workerErrors.length > 0) {
                const earliestFailure = workerErrors.reduce((earliest, current) =>
                    current.index < earliest.index ? current : earliest,
                );
                throw earliestFailure.error;
            }

            const completedBlocks = preparedBlocks.map((prepared) => {
                if (!prepared) {
                    throw new Error('Rolling block worker completed without a prepared result');
                }
                return prepared;
            });
            const fetchedBlockRecords = completedBlocks.map(({ result }) => ({
                blockNumber: result.block.blockNumber,
                blockHash: result.block.blockHash,
                parentHash: result.block.parentHash,
            }));
            validateBatchConnectivity(previousConfirmedBlock, fetchedBlockRecords, blockNumbers);

            const firstFetchStartedAt = Math.min(...fetchStartedAt);
            const lastFetchFinishedAt = Math.max(...fetchFinishedAt);
            const fetchStageDurationMs = Math.max(0, lastFetchFinishedAt - firstFetchStartedAt);
            totalConcurrentFetchMs += activeFetches * (Date.now() - lastFetchConcurrencyChangeAt);
            const averageConcurrentFetches =
                fetchStageDurationMs > 0 ? totalConcurrentFetchMs / fetchStageDurationMs : 0;
            const firstProcessingStartedAt = Math.min(...processingStartedAt);
            const lastProcessingFinishedAt = Math.max(...processingFinishedAt);
            const processingStageDurationMs = Math.max(
                0,
                lastProcessingFinishedAt - firstProcessingStartedAt,
            );

            const processedBlockRecords = completedBlocks.map(({ result }) => result.block);
            const candidates = completedBlocks.flatMap(({ result }) => result.candidates);
            const databaseWriteStartedAt = Date.now();
            const committedCheckpoint = await persistProcessedBlockBatch({
                candidates,
                blocks: processedBlockRecords,
                scannerStateId: state.id,
                expectedCheckpoint,
                newCheckpoint: blockNumbers[blockNumbers.length - 1],
            });
            const databaseWriteDurationMs = Date.now() - databaseWriteStartedAt;
            if (activeFetches === 0) noFetchDurationMs += Date.now() - noFetchStartedAt;

            if (committedCheckpoint !== blockNumbers[blockNumbers.length - 1]) {
                state.lastProcessedBlock = committedCheckpoint;
                // The checkpoint changed; never keep a cache for a different range.
                invalidateConfirmedBlockCache();
                continue;
            }

            state.lastProcessedBlock = committedCheckpoint;
            blocksProcessedThisCatchup += completedBlocks.length;
            // Advance the in-memory checkpoint only after the DB transaction has committed.
            cacheConfirmedCheckpointBlock(
                processedBlockRecords[processedBlockRecords.length - 1] ?? null,
                committedCheckpoint,
            );
            const perBlockDatabaseWriteDurationMs = Math.ceil(
                databaseWriteDurationMs / completedBlocks.length,
            );

            for (const { blockNumber, result } of completedBlocks) {
                result.databaseWriteDurationMs = perBlockDatabaseWriteDurationMs;
                const blockDurationMs = result.blockDurationMs + perBlockDatabaseWriteDurationMs;
                logBlockProcessed(
                    blockNumber,
                    result,
                    blockDurationMs,
                    state.lastProcessedBlock,
                    actualFinalizedBlockNumber,
                );
                accumulateBlockMetrics(totals, result, blockDurationMs, blockNumber);
            }
            recordProcessingBatch({
                startBlock: blockNumbers[0],
                endBlock: blockNumbers[blockNumbers.length - 1],
                blocks: completedBlocks.length,
                transactions: completedBlocks.reduce(
                    (total, item) => total + item.result.transactionCount,
                    0,
                ),
                durationMs: Date.now() - batchStartedAt,
                databaseWriteDurationMs,
                fetchStageDurationMs,
                processingStageDurationMs,
                noFetchDurationMs,
                persistenceStageDurationMs: databaseWriteDurationMs,
                configuredMaxParallelBlocks: maxParallelBlocks,
                parallelProcessingLagBlocks,
                lagAtBatchStart: lag,
                maxConcurrentFetches,
                maxConcurrentProcessing,
                averageConcurrentFetches,
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
