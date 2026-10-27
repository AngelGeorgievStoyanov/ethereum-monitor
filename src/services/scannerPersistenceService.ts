import { Op, Transaction as SequelizeTransaction } from 'sequelize';
import {
    createTransfersBatch,
    TransferBatchItem,
} from '../repositories/transactionRepository';
import { mapTransactionCreationData } from '../mappers/transactionContextMapper';
import sequelize from '../database';
import ScannerState from '../models/scannerState';
import Block from '../models/block';
import Transaction from '../models/transaction';
import { isScannerLockHeld } from './scannerLockService';
import { BlockChainDiscontinuityError } from '../errors/blockChainDiscontinuityError';
import type { TransferBatchCandidate } from './transactionService';

function mapTransferBatchItems(candidates: readonly TransferBatchCandidate[]): TransferBatchItem[] {
    return candidates.map((candidate) => ({
        data: mapTransactionCreationData(
            candidate.tx,
            candidate.receipt,
            candidate.blockTimestamp,
            candidate.transfer,
        ),
        matchingTxFilterIds: candidate.matchingTxFilters.map((filter) => filter.id),
    }));
}

export async function createTransactionsFromEthereumDataBatch(
    candidates: readonly TransferBatchCandidate[],
    transaction?: SequelizeTransaction,
    reconcileMatches = false,
): Promise<void> {
    await createTransfersBatch(mapTransferBatchItems(candidates), transaction, reconcileMatches);
}

export async function reconcileBlockCandidates(
    candidates: readonly TransferBatchCandidate[],
    scannerStateId: string,
    expectedCheckpoint: number,
): Promise<void> {
    if (!(await isScannerLockHeld())) {
        throw new Error('Cannot reconcile rescan matches without owning the scanner lock');
    }
    await sequelize.transaction(async (transaction) => {
        const state = await ScannerState.findByPk(scannerStateId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!state) throw new Error(`Scanner state "${scannerStateId}" was not found`);
        if (state.lastProcessedBlock !== expectedCheckpoint) {
            throw new Error(`Scanner checkpoint changed during rescan: expected ${expectedCheckpoint}, found ${state.lastProcessedBlock}`);
        }
        if (state.reorgRecoveryActive || state.reorgRecoveryBlocked) {
            throw new Error('Cannot reconcile rescan matches while reorg recovery is active or blocked');
        }
        if (!(await isScannerLockHeld())) {
            throw new Error('Scanner lock ownership was lost before reconciling rescan matches');
        }
        await createTransfersBatch(mapTransferBatchItems(candidates), transaction, true);
    });
}

export interface ProcessedBlockRecord {
    blockNumber: number;
    blockHash: string;
    parentHash: string;
}

export interface ReorgRecoveryProgress {
    active: boolean;
    stableBlocks: number;
    startBlock: number | null;
    targetBlock: number | null;
}

export async function persistProcessedBlockBatch(
    candidates: readonly TransferBatchCandidate[],
    blocks: readonly ProcessedBlockRecord[],
    scannerStateId: string,
    expectedCheckpoint: number,
    newCheckpoint: number,
    recoveryProgress?: ReorgRecoveryProgress,
): Promise<number> {
    return sequelize.transaction(async (transaction) => {
        const state = await ScannerState.findByPk(scannerStateId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!state) {
            throw new Error(`Scanner state "${scannerStateId}" was not found`);
        }

        // Another replica may have committed this range while we were fetching it.
        // In that case, discard this prepared batch and let the caller resume from DB state.
        if (state.lastProcessedBlock !== expectedCheckpoint) {
            return state.lastProcessedBlock;
        }
        if (!(await isScannerLockHeld())) {
            throw new Error('Scanner lock ownership was lost before persisting the processed block batch');
        }

        for (let index = 1; index < blocks.length; index += 1) {
            if (blocks[index].parentHash.toLowerCase() !== blocks[index - 1].blockHash.toLowerCase()) {
                throw new BlockChainDiscontinuityError(
                    blocks[index].blockNumber,
                    `Block chain discontinuity between ${blocks[index - 1].blockNumber} and ${blocks[index].blockNumber}`,
                );
            }
        }

        if (blocks.length > 0) {
            const previousCanonicalBlock = await Block.findOne({
                where: { blockNumber: expectedCheckpoint, status: 'CANONICAL' },
                transaction,
            });
            if (previousCanonicalBlock && blocks[0].parentHash.toLowerCase() !== previousCanonicalBlock.blockHash.toLowerCase()) {
                throw new BlockChainDiscontinuityError(
                    blocks[0].blockNumber,
                    `Block ${blocks[0].blockNumber} parent hash does not match canonical block ${expectedCheckpoint}; reorg recovery is required`,
                );
            }
            await Block.bulkCreate(blocks.map((block) => ({ ...block, status: 'CANONICAL' })), {
                updateOnDuplicate: ['blockNumber', 'parentHash', 'status'],
                transaction,
            });
        }

        const isReorgRecovery = recoveryProgress !== undefined;
        await createTransactionsFromEthereumDataBatch(candidates, transaction, isReorgRecovery);
        if (isReorgRecovery && blocks.length > 0) {
            await Transaction.update(
                { recordStatus: 'NORMAL' },
                { where: { blockHash: { [Op.in]: blocks.map((block) => block.blockHash) } }, transaction },
            );
        }
        state.lastProcessedBlock = newCheckpoint;
        if (recoveryProgress) {
            state.reorgRecoveryActive = recoveryProgress.active;
            state.reorgRecoveryStableBlocks = recoveryProgress.stableBlocks;
            state.reorgRecoveryStartBlock = recoveryProgress.startBlock;
            state.reorgRecoveryTargetBlock = recoveryProgress.targetBlock;
        }
        await state.save({ transaction });

        return newCheckpoint;
    });
}

