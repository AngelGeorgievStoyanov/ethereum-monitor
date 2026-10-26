import { TransactionResponse } from 'ethers';
import TxFilter from '../models/txFilter';
import { TransactionCreationAttributes } from '../models/transaction';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import {
    createTxMatches,
    deleteTransactionById,
    findAllTransactions,
    findOrCreateTransfer,
} from '../repositories/transactionRepository';

export interface TransferMetadata {
    transferType: 'native' | 'erc20';
    logIndex: number;
    from: string;
    to: string;
    value: string;
    tokenAddress?: string;
}

export async function createTransactionFromEthereumData(
    tx: TransactionResponse,
    receipt: RpcTransactionReceipt,
    blockTimestamp: number,
    transfer: TransferMetadata,
    matchingTxFilters: TxFilter[],
) {
    const data: TransactionCreationAttributes = {
        txHash: tx.hash,
        nonce: tx.nonce,
        blockHash: receipt.blockHash,
        blockNumber: Number(BigInt(receipt.blockNumber)),
        transactionIndex: Number(BigInt(receipt.transactionIndex)),
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        transferType: transfer.transferType,
        tokenAddress: transfer.tokenAddress ?? null,
        logIndex: transfer.logIndex,
        status: Number(BigInt(receipt.status ?? '0x0')) === 1 ? 'success' : 'failed',
        transactionType: tx.type?.toString(),
        timestamp: new Date(blockTimestamp * 1000),
    };

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
