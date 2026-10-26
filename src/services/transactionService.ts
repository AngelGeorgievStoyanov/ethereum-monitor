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

export async function persistProcessedBlockBatch(
    candidates: readonly TransferBatchCandidate[],
    scannerStateId: string,
    expectedCheckpoint: number,
    newCheckpoint: number,
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

        await createTransactionsFromEthereumDataBatch(candidates, transaction);
        state.lastProcessedBlock = newCheckpoint;
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
