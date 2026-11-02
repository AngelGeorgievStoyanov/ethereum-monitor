import {
    findCanonicalBlockIdentitiesInRange,
    type CanonicalBlockIdentity,
} from '../repositories/blockRepository';
import {
    RESCAN_BLOCK_IDENTITY_BATCH_SIZE,
    RESCAN_CANDIDATE_BATCH_SIZE,
    RESCAN_PROGRESS_LOG_INTERVAL_BLOCKS,
    RESCAN_PROGRESS_UPDATE_INTERVAL_BLOCKS,
} from '../constants/rescan.constants';
import { findScannerRescanState } from '../repositories/scannerStateRepository';
import {
    fetchBlockForProcessing,
    processFetchedBlock,
} from './blockProcessingService';
import { getBlockWithConsensus } from './blockConsensusService';
import { reconcileBlockCandidates } from './scannerPersistenceService';
import type { ActiveTxFilter } from '../types/tx-filter.types';
import type { TransferBatchCandidate } from '../types/transfer-batch.types';
import { iterateBlockRangeBatches } from '../utils/blockRangeBatch';
import { markReorgRecoveryPending } from './reorgRecoveryService';
import {
    recordReorgDetected,
    recordRescanBlockProcessed,
    recordRescanStarted,
} from './recoveryMetrics';

let rescanInProgress = false;

export class RescanReorgDetectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RescanReorgDetectedError';
    }
}

function matchesBlock(
    stored: { blockNumber: number; blockHash: string; parentHash: string },
    current: { blockNumber: number; blockHash: string; parentHash: string },
): boolean {
    return (
        stored.blockNumber === current.blockNumber &&
        stored.blockHash.toLowerCase() === current.blockHash.toLowerCase() &&
        stored.parentHash.toLowerCase() === current.parentHash.toLowerCase()
    );
}

interface RunManualRescanOptions {
    fromBlock: number;
    scannerStateId: string;
    getActiveTxFilters: () => ActiveTxFilter[];
    onProgress?: (currentBlock: number, blocksProcessed: number) => Promise<void>;
}

async function runManualRescanInternal({
    fromBlock,
    scannerStateId,
    getActiveTxFilters,
    onProgress,
}: RunManualRescanOptions): Promise<{
    fromBlock: number;
    toBlock: number;
    blocksProcessed: number;
}> {
    const initialState = await findScannerRescanState(scannerStateId);
    if (!initialState) throw new Error('Scanner state is not initialized');
    const checkpoint = initialState.lastProcessedBlock;

    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        throw new Error('fromBlock must be a non-negative integer');
    }
    if (fromBlock > checkpoint) {
        throw new Error(
            `fromBlock ${fromBlock} is greater than the last processed checkpoint ${checkpoint}`,
        );
    }
    if (initialState.reorgRecoveryActive || initialState.reorgRecoveryBlocked) {
        throw new Error('Manual rescan cannot start while reorg recovery is active or blocked');
    }

    const activeTxFilters = [...getActiveTxFilters()];
    console.log(
        `[Rescan] Started; range=${fromBlock}-${checkpoint}; checkpoint will not be changed`,
    );
    recordRescanStarted();

    let blocksProcessed = 0;
    let currentBlock = fromBlock - 1;
    let lastProgressReported = 0;
    const canonicalIdentities = new Map<number, CanonicalBlockIdentity>();
    const pendingCandidates: TransferBatchCandidate[] = [];

    const flushPendingCandidates = async (): Promise<void> => {
        if (pendingCandidates.length === 0) return;
        await reconcileBlockCandidates(pendingCandidates, scannerStateId, checkpoint);
        pendingCandidates.length = 0;
    };

    const reportProgress = async (): Promise<void> => {
        if (!onProgress || blocksProcessed === lastProgressReported) return;
        await onProgress(currentBlock, blocksProcessed);
        lastProgressReported = blocksProcessed;
    };

    try {
        for (const range of iterateBlockRangeBatches({
            fromBlock,
            toBlock: checkpoint,
            batchSize: RESCAN_BLOCK_IDENTITY_BATCH_SIZE,
            direction: 'forward',
        })) {
            const batch = await findCanonicalBlockIdentitiesInRange(
                range.fromBlock,
                range.toBlock,
            );
            canonicalIdentities.clear();
            for (const identity of batch) {
                canonicalIdentities.set(identity.blockNumber, identity);
            }

            for (
                let blockNumber = range.fromBlock;
                blockNumber <= range.toBlock;
                blockNumber += 1
            ) {

                const storedBlock = canonicalIdentities.get(blockNumber);
                if (!storedBlock) {
                    throw new Error(
                        `Cannot rescan block ${blockNumber}: canonical block history is missing`,
                    );
                }
                canonicalIdentities.delete(blockNumber);

                const fetched = await fetchBlockForProcessing(blockNumber);
                const fetchedIdentity = {
                    blockNumber: fetched.block.number,
                    blockHash: fetched.block.hash,
                    parentHash: fetched.block.parentHash,
                };

                if (!matchesBlock(storedBlock, fetchedIdentity)) {
                    const consensusBlock = await getBlockWithConsensus(blockNumber, 'manual rescan');
                    if (!matchesBlock(storedBlock, consensusBlock)) {
                        await flushPendingCandidates();
                        recordReorgDetected();
                        await markReorgRecoveryPending(scannerStateId, checkpoint);
                        throw new RescanReorgDetectedError(
                            `Chain mismatch found at block ${blockNumber}; reorg recovery was marked pending at checkpoint ${checkpoint}. The scanner will automatically resume and enter recovery.`,
                        );
                    }

                    throw new Error(
                        `RPC block response disagreed with provider consensus at block ${blockNumber}; stored canonical identity was confirmed by consensus. Rescan stopped without starting reorg recovery.`,
                    );
                }

                const prepared = await processFetchedBlock(fetched, activeTxFilters, true);
                if (!matchesBlock(storedBlock, prepared.block)) {
                    await flushPendingCandidates();
                    recordReorgDetected();
                    await markReorgRecoveryPending(scannerStateId, checkpoint);
                    throw new RescanReorgDetectedError(
                        `Fetched block data changed during processing at block ${blockNumber}; reorg recovery was marked pending at checkpoint ${checkpoint}. The scanner will automatically resume and enter recovery.`,
                    );
                }

                for (const candidate of prepared.candidates) {
                    pendingCandidates.push(candidate);
                    if (pendingCandidates.length >= RESCAN_CANDIDATE_BATCH_SIZE) {
                        await flushPendingCandidates();
                    }
                }
                currentBlock = blockNumber;
                blocksProcessed += 1;
                recordRescanBlockProcessed();

                if (blocksProcessed % RESCAN_PROGRESS_UPDATE_INTERVAL_BLOCKS === 0) {
                    await flushPendingCandidates();
                    await reportProgress();
                }
                if (blocksProcessed % RESCAN_PROGRESS_LOG_INTERVAL_BLOCKS === 0) {
                    console.log(
                        `[Rescan] Progress: processed ${blocksProcessed} block(s), current=${blockNumber}, range=${fromBlock}-${checkpoint}`,
                    );
                }
            }

            await flushPendingCandidates();
        }

        await reportProgress();
    } catch (error) {
        try {
            await flushPendingCandidates();
            await reportProgress();
        } catch (progressError) {
            console.error(
                `[Rescan] Failed to publish final progress after an error: ${String(progressError)}`,
            );
        }
        throw error;
    }

    console.log(
        `[Rescan] Completed; range=${fromBlock}-${checkpoint}; blocksProcessed=${blocksProcessed}; checkpoint unchanged`,
    );
    return { fromBlock, toBlock: checkpoint, blocksProcessed };
}

export async function runManualRescan(
    options: RunManualRescanOptions,
): Promise<{ fromBlock: number; toBlock: number; blocksProcessed: number }> {
    if (rescanInProgress)
        throw new Error('Another manual rescan is already running in this process');
    rescanInProgress = true;
    try {
        return await runManualRescanInternal(options);
    } finally {
        rescanInProgress = false;
    }
}
