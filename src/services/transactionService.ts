import { TransactionResponse } from 'ethers';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import {
    createTxMatches,
    deleteTransactionById,
    findAllTransactions,
    findOrCreateTransfer,
} from '../repositories/transactionRepository';
import {
    mapTransactionCreationData,
    TransferContextMetadata,
} from '../mappers/transactionContextMapper';

export type TransferMetadata = TransferContextMetadata;

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

export function listStoredTransactions() {
    return findAllTransactions();
}

export function deleteStoredTransaction(id: number) {
    return deleteTransactionById(id);
}
