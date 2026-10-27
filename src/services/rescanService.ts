import Block from '../models/block';
import ScannerState from '../models/scannerState';
import { processBlock } from './blockProcessingService';
import { getBlockWithConsensus } from './blockConsensusService';
import { reconcileBlockCandidates } from './transactionService';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { markReorgRecoveryPending } from './reorgRecoveryService';
import { isScannerLockHeld } from './scannerLockService';
import { recordRescanBlockProcessed, recordRescanStarted } from './recoveryMetrics';

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
    return stored.blockNumber === current.blockNumber &&
        stored.blockHash.toLowerCase() === current.blockHash.toLowerCase() &&
        stored.parentHash.toLowerCase() === current.parentHash.toLowerCase();
}

async function runManualRescanInternal(
    fromBlock: number,
    state: ScannerState,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<{ fromBlock: number; toBlock: number; blocksProcessed: number }> {
    if (!(await isScannerLockHeld())) {
        throw new Error('Manual rescan requires this instance to own the scanner lock');
    }
    await state.reload();
    const checkpoint = state.lastProcessedBlock;

    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        throw new Error('fromBlock must be a non-negative integer');
    }
    if (fromBlock > checkpoint) {
        throw new Error(`fromBlock ${fromBlock} is greater than the last processed checkpoint ${checkpoint}`);
    }
    if (state.reorgRecoveryActive || state.reorgRecoveryBlocked) {
        throw new Error('Manual rescan cannot start while reorg recovery is active or blocked');
    }

    // A single filter snapshot prevents one rescan from applying different rules to different blocks.
    const activeTxFilters = [...getActiveTxFilters()];
    console.log(`[Rescan] Started; range=${fromBlock}-${checkpoint}; checkpoint will not be changed`);
    recordRescanStarted();
    let blocksProcessed = 0;

    for (let blockNumber = fromBlock; blockNumber <= checkpoint; blockNumber += 1) {
        if (!(await isScannerLockHeld())) {
            throw new Error(`Manual rescan stopped before block ${blockNumber}: scanner lock ownership was lost`);
        }
        await state.reload();
        if (state.lastProcessedBlock !== checkpoint) {
            throw new Error(`Scanner checkpoint changed during rescan: expected ${checkpoint}, found ${state.lastProcessedBlock}`);
        }
        if (state.reorgRecoveryActive || state.reorgRecoveryBlocked) {
            throw new Error('Manual rescan stopped because reorg recovery became active or blocked');
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

        const prepared = await processBlock(blockNumber, activeTxFilters, true);
        if (!matchesBlock(storedBlock, prepared.block) || !matchesBlock(consensusBlock, prepared.block)) {
            await markReorgRecoveryPending(state, checkpoint);
            throw new RescanReorgDetectedError(
                `Fetched block data changed or disagreed with consensus at block ${blockNumber}; reorg recovery was marked pending at checkpoint ${checkpoint}.`,
            );
        }

        if (!(await isScannerLockHeld())) {
            throw new Error(`Manual rescan stopped before saving block ${blockNumber}: scanner lock ownership was lost`);
        }
        await reconcileBlockCandidates(prepared.candidates, state.id, checkpoint);
        blocksProcessed += 1;
        recordRescanBlockProcessed();
        if (blocksProcessed % 100 === 0) {
            console.log(`[Rescan] Progress: processed ${blocksProcessed} block(s), current=${blockNumber}, range=${fromBlock}-${checkpoint}`);
        }
    }

    console.log(`[Rescan] Completed; range=${fromBlock}-${checkpoint}; blocksProcessed=${blocksProcessed}; checkpoint unchanged`);
    return { fromBlock, toBlock: checkpoint, blocksProcessed };
}

export async function runManualRescan(
    fromBlock: number,
    state: ScannerState,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<{ fromBlock: number; toBlock: number; blocksProcessed: number }> {
    if (rescanInProgress) throw new Error('Another manual rescan is already running in this process');
    rescanInProgress = true;
    try {
        return await runManualRescanInternal(fromBlock, state, getActiveTxFilters);
    } finally {
        rescanInProgress = false;
    }
}
