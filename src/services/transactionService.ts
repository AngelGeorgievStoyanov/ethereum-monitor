import { TransactionResponse } from 'ethers';
import Configuration from '../models/configuration';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import {
    createTransaction,
    deleteTransactionById,
    findAllTransactions,
    findExistingTransfer,
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
    config: Configuration,
    blockTimestamp: number,
    transfer: TransferMetadata,
) {
    const existing = await findExistingTransfer(
        config.id,
        tx.hash,
        transfer.transferType,
        transfer.logIndex,
    );

    if (existing) {
        return existing;
    }

    const data = {
        configurationId: config.id,
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
        gas: Number(BigInt(receipt.gasUsed)),
        gasPrice: tx.gasPrice?.toString() ?? tx.maxFeePerGas?.toString() ?? '0',
        input: tx.data,
        status: Number(BigInt(receipt.status ?? '0x0')) === 1 ? 'success' : 'failed',
        transactionType: tx.type?.toString(),
        contractAddress: receipt.contractAddress ?? undefined,
        timestamp: new Date(blockTimestamp * 1000),
        gasLimit: Number(tx.gasLimit),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? undefined,
        maxFeePerGas: tx.maxFeePerGas?.toString() ?? undefined,
        maxFeePerBlobGas: tx.maxFeePerBlobGas?.toString() ?? undefined,
        accessList: tx.accessList ? JSON.stringify(tx.accessList) : undefined,
        blobVersionedHashes: tx.blobVersionedHashes
            ? JSON.stringify(tx.blobVersionedHashes)
            : undefined,
        logsBloom: receipt.logsBloom ?? undefined,
        gasUsed: Number(BigInt(receipt.gasUsed)),
        cumulativeGasUsed: Number(BigInt(receipt.cumulativeGasUsed)),
        root: receipt.root ?? undefined,
        blobGasUsed: receipt.blobGasUsed ? Number(BigInt(receipt.blobGasUsed)) : undefined,
    };

    return createTransaction(data);
}


export function listStoredTransactions() {
    return findAllTransactions();
}

export function deleteStoredTransaction(id: string) {
    return deleteTransactionById(id);
}
