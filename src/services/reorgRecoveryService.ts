import { Op } from 'sequelize';
import sequelize from '../database';
import { MAX_REORG_LOOKBACK_BLOCKS, REORG_RECOVERY_STABLE_BLOCKS } from '../constants/scanner.constants';
import Block from '../models/block';
import StoredTransaction from '../models/transaction';
import TxMatch from '../models/txMatch';
import ScannerState from '../models/scannerState';
import { processBlock } from './blockProcessingService';
import { getBlockWithConsensus } from './blockConsensusService';
import { persistProcessedBlockBatch } from './transactionService';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { isScannerLockHeld } from './scannerLockService';

function sameBlock(stored: Block, current: { blockHash: string; parentHash: string }): boolean {
    return stored.blockHash.toLowerCase() === current.blockHash.toLowerCase() &&
        stored.parentHash.toLowerCase() === current.parentHash.toLowerCase();
}

export async function markReorgRecoveryPending(state: ScannerState, checkpoint: number): Promise<void> {
    await sequelize.transaction(async (transaction) => {
        const persistedState = await ScannerState.findByPk(state.id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!persistedState) throw new Error(`Scanner state "${state.id}" was not found`);
        persistedState.reorgRecoveryActive = true;
        persistedState.reorgRecoveryStableBlocks = 0;
        persistedState.reorgRecoveryStartBlock = checkpoint;
        await persistedState.save({ transaction });
    });
    await state.reload();
}

async function findAncestorAndRollback(state: ScannerState): Promise<void> {
    const originalCheckpoint = state.reorgRecoveryStartBlock;
    if (originalCheckpoint === null) throw new Error('Reorg recovery has no checkpoint to reconcile');

    console.warn(`[Reorg] Searching for a common ancestor below block ${originalCheckpoint}`);
    let ancestor: Block | null = null;

    for (let depth = 1; depth <= MAX_REORG_LOOKBACK_BLOCKS; depth += 1) {
        const blockNumber = originalCheckpoint - depth;
        if (blockNumber < 0) break;

        const storedBlock = await Block.findOne({
            where: { blockNumber, status: 'CANONICAL' },
        });
        if (!storedBlock) {
            throw new Error(`Cannot safely recover reorg at block ${originalCheckpoint}: block history is missing at ${blockNumber}`);
        }

        const currentBlock = await getBlockWithConsensus(blockNumber, 'common ancestor search');
        if (sameBlock(storedBlock, currentBlock)) {
            ancestor = storedBlock;
            break;
        }
    }

    if (!ancestor) {
        throw new Error(`No common ancestor found within ${MAX_REORG_LOOKBACK_BLOCKS} blocks below ${originalCheckpoint}`);
    }

    await sequelize.transaction(async (transaction) => {
        const persistedState = await ScannerState.findByPk(state.id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!persistedState) throw new Error(`Scanner state "${state.id}" was not found`);
        if (persistedState.lastProcessedBlock !== originalCheckpoint) {
            throw new Error(`Checkpoint changed while recovering reorg: expected ${originalCheckpoint}, found ${persistedState.lastProcessedBlock}`);
        }

        const orphanedBlocks = await Block.findAll({
            where: {
                status: 'CANONICAL',
                blockNumber: { [Op.gt]: ancestor.blockNumber, [Op.lte]: originalCheckpoint },
            },
            transaction,
        });
        const orphanedBlockHashes = orphanedBlocks.map((block) => block.blockHash);
        const orphanedTransactions = orphanedBlockHashes.length === 0
            ? []
            : await StoredTransaction.findAll({
                where: { blockHash: { [Op.in]: orphanedBlockHashes } },
                attributes: ['id'],
                transaction,
            });
        const orphanedTransactionIds = orphanedTransactions.map((item) => item.id);

        await Block.update(
            { status: 'REORGED' },
            {
                where: {
                    status: 'CANONICAL',
                    blockNumber: { [Op.gt]: ancestor.blockNumber, [Op.lte]: originalCheckpoint },
                },
                transaction,
            },
        );
        if (orphanedBlockHashes.length > 0) {
            await StoredTransaction.update(
                { recordStatus: 'REORGED' },
                { where: { blockHash: { [Op.in]: orphanedBlockHashes } }, transaction },
            );
        }
        if (orphanedTransactionIds.length > 0) {
            await TxMatch.update(
                { matchStatus: 'REORGED' },
                {
                    where: {
                        txId: { [Op.in]: orphanedTransactionIds },
                        matchStatus: { [Op.ne]: 'FILTER_DELETED' },
                    },
                    transaction,
                },
            );
        }

        persistedState.lastProcessedBlock = ancestor!.blockNumber;
        persistedState.reorgRecoveryActive = true;
        persistedState.reorgRecoveryStableBlocks = 0;
        persistedState.reorgRecoveryStartBlock = null;
        await persistedState.save({ transaction });
    });

    await state.reload();
    console.warn(
        `[Reorg] Common ancestor=${ancestor.blockNumber}; marked ${state.lastProcessedBlock < originalCheckpoint ? originalCheckpoint - state.lastProcessedBlock : 0} block(s) as reorged; checkpoint rolled back to ${state.lastProcessedBlock}`,
    );
}

export async function processReorgRecovery(
    state: ScannerState,
    finalizedBlockNumber: number,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<boolean> {
    if (state.lastProcessedBlock < 0 && !state.reorgRecoveryActive) return false;

    if (state.reorgRecoveryActive && state.reorgRecoveryStartBlock !== null) {
        await findAncestorAndRollback(state);
    } else if (!state.reorgRecoveryActive) {
        const storedCheckpoint = await Block.findOne({
            where: { blockNumber: state.lastProcessedBlock, status: 'CANONICAL' },
        });
        if (!storedCheckpoint) return false;

        const currentCheckpoint = await getBlockWithConsensus(state.lastProcessedBlock, 'reorg detection');
        if (sameBlock(storedCheckpoint, currentCheckpoint)) return false;

        console.error(
            `[Reorg] Detected chain mismatch at block ${state.lastProcessedBlock}; storedHash=${storedCheckpoint.blockHash}; currentHash=${currentCheckpoint.blockHash}`,
        );
        await markReorgRecoveryPending(state, state.lastProcessedBlock);
        await findAncestorAndRollback(state);
    }

    if (!state.reorgRecoveryActive) return true;
    const filters = getActiveTxFilters();
    if (filters.length === 0) {
        console.warn('[Reorg] Recovery is paused because there are no active transaction filters');
        return true;
    }

    while (state.reorgRecoveryActive && state.lastProcessedBlock < finalizedBlockNumber) {
        if (!(await isScannerLockHeld())) {
            console.warn('[Reorg] Scanner lock lost; recovery will resume after the lock is reacquired');
            return true;
        }

        const blockNumber = state.lastProcessedBlock + 1;
        const consensusBlock = await getBlockWithConsensus(blockNumber, 'reorg recovery');
        const previousCanonicalBlock = await Block.findOne({
            where: { blockNumber: state.lastProcessedBlock, status: 'CANONICAL' },
        });
        if (previousCanonicalBlock && consensusBlock.parentHash.toLowerCase() !== previousCanonicalBlock.blockHash.toLowerCase()) {
            console.warn(`[Reorg] Chain changed again during recovery at block ${blockNumber}; restarting ancestor search`);
            await markReorgRecoveryPending(state, state.lastProcessedBlock);
            await findAncestorAndRollback(state);
            continue;
        }

        const prepared = await processBlock(blockNumber, filters, true);
        if (
            prepared.block.blockNumber !== consensusBlock.blockNumber ||
            prepared.block.blockHash.toLowerCase() !== consensusBlock.blockHash.toLowerCase() ||
            prepared.block.parentHash.toLowerCase() !== consensusBlock.parentHash.toLowerCase()
        ) {
            throw new Error(`Block data fetched for recovery block ${blockNumber} does not match provider consensus`);
        }

        const stableBlocks = state.reorgRecoveryStableBlocks + 1;
        const recoveryComplete = stableBlocks >= REORG_RECOVERY_STABLE_BLOCKS;
        const committedCheckpoint = await persistProcessedBlockBatch(
            prepared.candidates,
            [prepared.block],
            state.id,
            state.lastProcessedBlock,
            blockNumber,
            {
                active: !recoveryComplete,
                stableBlocks: recoveryComplete ? 0 : stableBlocks,
                startBlock: null,
            },
        );
        if (committedCheckpoint !== blockNumber) {
            await state.reload();
            continue;
        }

        state.lastProcessedBlock = blockNumber;
        state.reorgRecoveryActive = !recoveryComplete;
        state.reorgRecoveryStableBlocks = recoveryComplete ? 0 : stableBlocks;
        state.reorgRecoveryStartBlock = null;
        console.log(
            `[Reorg] Recovery block ${blockNumber} committed with consensus; stable=${stableBlocks}/${REORG_RECOVERY_STABLE_BLOCKS}; checkpoint=${state.lastProcessedBlock}`,
        );
        if (recoveryComplete) {
            console.log(`[Reorg] Recovery completed at block ${blockNumber}; normal scanner mode may resume`);
            return true;
        }
    }

    return true;
}
