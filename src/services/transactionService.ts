import { TransactionResponse } from 'ethers';
import TxFilter from '../models/txFilter';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import {
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
    config: TxFilter,
    blockTimestamp: number,
    transfer: TransferMetadata,
) {
    const data = {
        txFilterId: config.id,
        hash: tx.hash,
        nonce: tx.nonce,
        blockHash: receipt.blockHash,
        blockNumber: Number(BigInt(receipt.blockNumber)),
        transactionIndex: Number(BigInt(receipt.transactionIndex)),
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        transferType: transfer.transferType,
        tokenAddress: transfer.tokenAddress,
        logIndex: transfer.logIndex,
        status: Number(BigInt(receipt.status ?? '0x0')) === 1 ? 'success' : 'failed',
        transactionType: tx.type?.toString(),
        timestamp: new Date(blockTimestamp * 1000),
    };

    return findOrCreateTransfer(data);
}

export function listStoredTransactions() {
    return findAllTransactions();
}

export function deleteStoredTransaction(id: string) {
    return deleteTransactionById(id);
}
