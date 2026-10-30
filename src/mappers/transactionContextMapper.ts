import { TransactionResponse } from 'ethers';
import type {
    TransactionPersistenceData,
    TransferContextMetadata,
} from '../types/transaction.types';
import { RpcTransactionReceipt } from '../types/evm-rpc.types';

function getTransactionStatus(receipt: RpcTransactionReceipt): 'success' | 'failed' {
    return Number(BigInt(receipt.status ?? '0x0')) === 1 ? 'success' : 'failed';
}

export function mapTransactionFilterContext(
    tx: TransactionResponse,
    receipt: RpcTransactionReceipt,
    blockNumber: number,
    blockTimestamp: number,
    transfer: TransferContextMetadata,
) {
    return {
        txHash: tx.hash.toLowerCase(),
        transferType: transfer.transferType,
        tokenAddress: transfer.tokenAddress?.toLowerCase() ?? null,
        logIndex: transfer.logIndex,
        nonce: tx.nonce,
        blockHash: receipt.blockHash.toLowerCase(),
        blockNumber,
        transactionIndex: Number(BigInt(receipt.transactionIndex)),
        from: transfer.from.toLowerCase(),
        to: transfer.to.toLowerCase(),
        value: BigInt(transfer.value),
        internalCount: null,
        status: getTransactionStatus(receipt),
        transactionType: tx.type?.toString() ?? null,
        timestamp: blockTimestamp * 1000,
    };
}

export function mapTransactionCreationData(
    tx: TransactionResponse,
    receipt: RpcTransactionReceipt,
    blockTimestamp: number,
    transfer: TransferContextMetadata,
): TransactionPersistenceData {
    return {
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
        chainStatus: getTransactionStatus(receipt).toUpperCase() as 'SUCCESS' | 'FAILED',
        recordStatus: 'NORMAL',
        transactionType: tx.type?.toString(),
        timestamp: new Date(blockTimestamp * 1000),
    };
}
