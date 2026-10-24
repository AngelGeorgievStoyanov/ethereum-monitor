import { TransactionReceipt, TransactionResponse } from 'ethers';
import Configuration from '../models/configuration';
import { createTransaction, findExistingTransfer } from '../repositories/transactionRepository';

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
    receipt: TransactionReceipt,
    config: Configuration,
    blockTimestamp: number,
    transfer: TransferMetadata
) {
    const existing = await findExistingTransfer(
        config.id,
        tx.hash,
        transfer.transferType,
        transfer.logIndex
    );

    if (existing) {
        return existing;
    }

    const data = {
        configurationId: config.id,
        hash: tx.hash,
        nonce: tx.nonce,
        blockHash: receipt.blockHash,
        blockNumber: Number(receipt.blockNumber),
        transactionIndex: receipt.transactionIndex,
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        transferType: transfer.transferType,
        tokenAddress: transfer.tokenAddress,
        logIndex: transfer.logIndex,
        gas: Number(receipt.gasUsed),
        gasPrice: tx.gasPrice?.toString() ?? tx.maxFeePerGas?.toString() ?? '0',
        input: tx.data,
        status: receipt.status === 1 ? 'success' : 'failed',
        transactionType: tx.type?.toString(),
        contractAddress: receipt.contractAddress ?? undefined,
        timestamp: new Date(blockTimestamp * 1000),
        gasLimit: Number(tx.gasLimit),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? undefined,
        maxFeePerGas: tx.maxFeePerGas?.toString() ?? undefined,
        maxFeePerBlobGas: tx.maxFeePerBlobGas?.toString() ?? undefined,
        accessList: tx.accessList ? JSON.stringify(tx.accessList) : undefined,
        blobVersionedHashes: tx.blobVersionedHashes ? JSON.stringify(tx.blobVersionedHashes) : undefined,
        logsBloom: receipt.logsBloom ?? undefined,
        gasUsed: Number(receipt.gasUsed),
        cumulativeGasUsed: Number(receipt.cumulativeGasUsed),
        root: receipt.root ?? undefined,
        blobGasUsed: receipt.blobGasUsed ? Number(receipt.blobGasUsed) : undefined,
    };

    return createTransaction(data);
}
