import Block from '../models/block';
import ScannerState from '../models/scannerState';
import { processBlock } from './blockProcessingService';
import { getBlockWithConsensus } from './blockConsensusService';
import { reconcileBlockCandidates } from './transactionService';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { markReorgRecoveryPending } from './reorgRecoveryService';

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
    return stored.blockNumber === current.blockNumber &&
        stored.blockHash.toLowerCase() === current.blockHash.toLowerCase() &&
        stored.parentHash.toLowerCase() === current.parentHash.toLowerCase();
}

export async function runManualRescan(
    fromBlock: number,
    state: ScannerState,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<{ fromBlock: number; toBlock: number; blocksProcessed: number }> {
    await state.reload();
    const checkpoint = state.lastProcessedBlock;

    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        throw new Error('fromBlock must be a non-negative integer');
    }
    if (fromBlock > checkpoint) {
        throw new Error(`fromBlock ${fromBlock} is greater than the last processed checkpoint ${checkpoint}`);
    }
    if (state.reorgRecoveryActive) {
        throw new Error('Manual rescan cannot start while reorg recovery is active');
    }

    console.log(`[Rescan] Started; range=${fromBlock}-${checkpoint}; checkpoint will not be changed`);
    let blocksProcessed = 0;

    for (let blockNumber = fromBlock; blockNumber <= checkpoint; blockNumber += 1) {
        await state.reload();
        if (state.lastProcessedBlock !== checkpoint) {
            throw new Error(`Scanner checkpoint changed during rescan: expected ${checkpoint}, found ${state.lastProcessedBlock}`);
        }
        if (state.reorgRecoveryActive) {
            throw new Error('Manual rescan stopped because reorg recovery became active');
        }

        const storedBlock = await Block.findOne({ where: { blockNumber, status: 'CANONICAL' } });
        if (!storedBlock) {
            throw new Error(`Cannot rescan block ${blockNumber}: canonical block history is missing`);
        }

        const consensusBlock = await getBlockWithConsensus(blockNumber, 'manual rescan');
        if (!matchesBlock(storedBlock, consensusBlock)) {
            await markReorgRecoveryPending(state, checkpoint);
            throw new RescanReorgDetectedError(
                `Chain mismatch found at block ${blockNumber}; reorg recovery was marked pending at checkpoint ${checkpoint}. Resume the scanner to recover before retrying the rescan.`,
            );
        }

        const prepared = await processBlock(blockNumber, getActiveTxFilters(), true);
        if (!matchesBlock(storedBlock, prepared.block) || !matchesBlock(consensusBlock, prepared.block)) {
            await markReorgRecoveryPending(state, checkpoint);
            throw new RescanReorgDetectedError(
                `Fetched block data changed or disagreed with consensus at block ${blockNumber}; reorg recovery was marked pending at checkpoint ${checkpoint}.`,
            );
        }

        await reconcileBlockCandidates(prepared.candidates);
        blocksProcessed += 1;
        if (blocksProcessed % 100 === 0) {
            console.log(`[Rescan] Progress: processed ${blocksProcessed} block(s), current=${blockNumber}, range=${fromBlock}-${checkpoint}`);
        }
    }

    console.log(`[Rescan] Completed; range=${fromBlock}-${checkpoint}; blocksProcessed=${blocksProcessed}; checkpoint unchanged`);
    return { fromBlock, toBlock: checkpoint, blocksProcessed };
}
