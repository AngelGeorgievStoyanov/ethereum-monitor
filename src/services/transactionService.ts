import { Transaction as SequelizeTransaction } from 'sequelize';
import { TransactionResponse } from 'ethers';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import {
    createTxMatches,
    createTransfersBatch,
    TransferBatchItem,
    deleteTransactionById,
    findTransactionsPage,
    findOrCreateTransfer,
} from '../repositories/transactionRepository';
import {
    mapTransactionCreationData,
    TransferContextMetadata,
} from '../mappers/transactionContextMapper';
import sequelize from '../database';
import ScannerState from '../models/scannerState';
import Block from '../models/block';

export type TransferMetadata = TransferContextMetadata;

export interface TransferBatchCandidate {
    tx: TransactionResponse;
    receipt: RpcTransactionReceipt;
    blockTimestamp: number;
    transfer: TransferMetadata;
    matchingTxFilters: ActiveTxFilter[];
}

export async function createTransactionsFromEthereumDataBatch(
    candidates: readonly TransferBatchCandidate[],
    transaction?: SequelizeTransaction,
): Promise<void> {
    const items: TransferBatchItem[] = candidates.map((candidate) => ({
        data: mapTransactionCreationData(
            candidate.tx,
            candidate.receipt,
            candidate.blockTimestamp,
            candidate.transfer,
        ),
        matchingTxFilterIds: candidate.matchingTxFilters.map((filter) => filter.id),
    }));

    await createTransfersBatch(items, transaction);
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

        for (let index = 1; index < blocks.length; index += 1) {
            if (blocks[index].parentHash.toLowerCase() !== blocks[index - 1].blockHash.toLowerCase()) {
                throw new Error(`Block chain discontinuity between ${blocks[index - 1].blockNumber} and ${blocks[index].blockNumber}`);
            }
        }

        if (blocks.length > 0) {
            const previousCanonicalBlock = await Block.findOne({
                where: { blockNumber: expectedCheckpoint, status: 'CANONICAL' },
                transaction,
            });
            if (previousCanonicalBlock && blocks[0].parentHash.toLowerCase() !== previousCanonicalBlock.blockHash.toLowerCase()) {
                throw new Error(`Block ${blocks[0].blockNumber} parent hash does not match canonical block ${expectedCheckpoint}; reorg recovery is required`);
            }
            await Block.bulkCreate(blocks.map((block) => ({ ...block, status: 'CANONICAL' })), {
                updateOnDuplicate: ['blockNumber', 'parentHash', 'status'],
                transaction,
            });
        }

        await createTransactionsFromEthereumDataBatch(candidates, transaction);
        state.lastProcessedBlock = newCheckpoint;
        if (recoveryProgress) {
            state.reorgRecoveryActive = recoveryProgress.active;
            state.reorgRecoveryStableBlocks = recoveryProgress.stableBlocks;
            state.reorgRecoveryStartBlock = recoveryProgress.startBlock;
        }
        await state.save({ transaction });

        return newCheckpoint;
    });
}

export async function createTransactionFromEthereumData(
    tx: TransactionResponse,
    receipt: RpcTransactionReceipt,
    blockTimestamp: number,
    transfer: TransferMetadata,
    matchingTxFilters: ActiveTxFilter[],
) {
    const data = mapTransactionCreationData(tx, receipt, blockTimestamp, transfer);
    const transaction = await findOrCreateTransfer(data);
    await createTxMatches(
        transaction.id,
        matchingTxFilters.map((txFilter) => txFilter.id),
    );

    return transaction;
}

export function listStoredTransactions(page: number, limit: number) {
    return findTransactionsPage(page, limit);
}

export function deleteStoredTransaction(id: number) {
    return deleteTransactionById(id);
}
