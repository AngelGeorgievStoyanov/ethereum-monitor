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

    await createTransfersBatch(items);
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
