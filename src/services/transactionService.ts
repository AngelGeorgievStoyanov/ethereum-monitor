import { TransactionResponse } from 'ethers';
import type { ActiveTxFilter } from '../types/tx-filter.types';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import {
    createTxMatches,
    deleteTransactionById,
    findTransactionsPage,
    findOrCreateTransfer,
} from '../repositories/transactionRepository';
import {
    mapTransactionCreationData,
} from '../mappers/transactionContextMapper';
import type { TransferContextMetadata } from '../types/transaction.types';
import { mapTransactionPageResponse } from '../mappers/transactionResponseMapper';

export type TransferMetadata = TransferContextMetadata;


export interface CreateTransactionFromEthereumDataOptions {
    tx: TransactionResponse;
    receipt: RpcTransactionReceipt;
    blockTimestamp: number;
    transfer: TransferMetadata;
    matchingTxFilters: ActiveTxFilter[];
}

export async function createTransactionFromEthereumData({
    tx,
    receipt,
    blockTimestamp,
    transfer,
    matchingTxFilters,
}: CreateTransactionFromEthereumDataOptions) {
    const data = mapTransactionCreationData(tx, receipt, blockTimestamp, transfer);
    const transaction = await findOrCreateTransfer(data);
    await createTxMatches(
        transaction.id,
        matchingTxFilters.map(({ id, description }) => ({ id, description })),
    );

    return transaction;
}

export async function listStoredTransactions(page: number, limit: number) {
    const result = await findTransactionsPage(page, limit);
    return mapTransactionPageResponse(result);
}

export function deleteStoredTransaction(id: number) {
    return deleteTransactionById(id);
}
