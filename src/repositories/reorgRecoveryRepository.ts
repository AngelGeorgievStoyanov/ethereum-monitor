import { Op, Transaction } from 'sequelize';
import sequelize from '../database';
import Block from '../models/block';
import StoredTransaction from '../models/transaction';
import TxMatch from '../models/txMatch';
import ScannerState from '../models/scannerState';

export interface CanonicalBlockRecord {
    blockNumber: number;
    blockHash: string;
    parentHash: string;
}

export async function findCanonicalBlock(
    blockNumber: number,
): Promise<CanonicalBlockRecord | null> {
    const block = await Block.findOne({
        where: { blockNumber, status: 'CANONICAL' },
        attributes: ['blockNumber', 'blockHash', 'parentHash'],
    });
    return block
        ? { blockNumber: block.blockNumber, blockHash: block.blockHash, parentHash: block.parentHash }
        : null;
}

export async function hasCanonicalBlocks(): Promise<boolean> {
    return (await Block.count({ where: { status: 'CANONICAL' } })) > 0;
}

export async function markReorgRecoveryPending(
    scannerStateId: string,
    checkpoint: number,
    targetBlock: number,
): Promise<void> {
    await sequelize.transaction(async (transaction) => {
        const state = await findLockedScannerState(scannerStateId, transaction);
        state.reorgRecoveryActive = true;
        state.reorgRecoveryBlocked = false;
        state.reorgRecoveryBlockReason = null;
        state.reorgRecoveryStableBlocks = 0;
        state.reorgRecoveryStartBlock = checkpoint;
        state.reorgRecoveryTargetBlock = targetBlock;
        await state.save({ transaction });
    });
}

export async function rollbackToCommonAncestor(input: {
    scannerStateId: string;
    expectedCheckpoint: number;
    ancestorBlockNumber: number;
    stableBlocks: number;
}): Promise<{ checkpoint: number; orphanedBlockCount: number }> {
    return sequelize.transaction(async (transaction) => {
        const state = await findLockedScannerState(input.scannerStateId, transaction);
        if (state.lastProcessedBlock !== input.expectedCheckpoint) {
            throw new Error(
                `Checkpoint changed while recovering reorg: expected ${input.expectedCheckpoint}, found ${state.lastProcessedBlock}`,
            );
        }

        const range = {
            status: 'CANONICAL',
            blockNumber: {
                [Op.gt]: input.ancestorBlockNumber,
                [Op.lte]: input.expectedCheckpoint,
            },
        };
        const orphanedBlocks = await Block.findAll({
            where: range,
            attributes: ['blockHash'],
            transaction,
        });
        const orphanedBlockHashes = orphanedBlocks.map((block) => block.blockHash);
        const orphanedTransactions = orphanedBlockHashes.length
            ? await StoredTransaction.findAll({
                  where: { blockHash: { [Op.in]: orphanedBlockHashes } },
                  attributes: ['id'],
                  transaction,
              })
            : [];
        const orphanedTransactionIds = orphanedTransactions.map((item) => item.id);

        await Block.update({ status: 'REORGED' }, { where: range, transaction });
        if (orphanedBlockHashes.length) {
            await StoredTransaction.update(
                { recordStatus: 'REORGED' },
                { where: { blockHash: { [Op.in]: orphanedBlockHashes } }, transaction },
            );
        }
        if (orphanedTransactionIds.length) {
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

        if (state.reorgRecoveryTargetBlock === null) {
            state.reorgRecoveryTargetBlock =
                input.expectedCheckpoint + input.stableBlocks;
        }
        state.lastProcessedBlock = input.ancestorBlockNumber;
        state.reorgRecoveryActive = true;
        state.reorgRecoveryStableBlocks = 0;
        state.reorgRecoveryStartBlock = null;
        await state.save({ transaction });

        return {
            checkpoint: state.lastProcessedBlock,
            orphanedBlockCount: orphanedBlockHashes.length,
        };
    });
}

export async function markReorgRecoveryBlocked(input: {
    scannerStateId: string;
    reason: string;
    initializeRecovery?: boolean;
    preserveStartBlock?: boolean;
    stableBlocks: number;
}): Promise<void> {
    await sequelize.transaction(async (transaction) => {
        const state = await findLockedScannerState(input.scannerStateId, transaction);
        if (input.initializeRecovery) {
            if (!state.reorgRecoveryActive) {
                state.reorgRecoveryActive = true;
                state.reorgRecoveryStartBlock = state.lastProcessedBlock;
                state.reorgRecoveryTargetBlock = state.lastProcessedBlock + input.stableBlocks;
                state.reorgRecoveryStableBlocks = 0;
            }
        } else {
            state.reorgRecoveryActive = true;
            if (!input.preserveStartBlock && state.reorgRecoveryStartBlock === null) {
                state.reorgRecoveryStartBlock = state.lastProcessedBlock;
            }
            if (state.reorgRecoveryTargetBlock === null) {
                state.reorgRecoveryTargetBlock = state.lastProcessedBlock + input.stableBlocks;
            }
        }
        state.reorgRecoveryBlocked = true;
        state.reorgRecoveryBlockReason = input.reason.slice(0, 500);
        await state.save({ transaction });
    });
}

async function findLockedScannerState(
    id: string,
    transaction: Transaction,
) {
    const state = await ScannerState.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    if (!state) throw new Error(`Scanner state "${id}" was not found`);
    return state;
}
