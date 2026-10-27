import { TransactionResponse } from 'ethers';
import { TransactionCreationAttributes } from '../models/transaction';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';

export interface TransferContextMetadata {
    transferType: 'native' | 'erc20';
    tokenAddress?: string | null;
    logIndex: number;
    from: string;
    to: string;
    value: string;
}

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
        txHash: tx.hash,
        transferType: transfer.transferType,
        tokenAddress: transfer.tokenAddress ?? null,
        logIndex: transfer.logIndex,
        nonce: tx.nonce,
        blockHash: receipt.blockHash,
        blockNumber,
        transactionIndex: Number(BigInt(receipt.transactionIndex)),
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        internalCount: null,
        status: getTransactionStatus(receipt),
        transactionType: tx.type?.toString() ?? null,
        timestamp: new Date(blockTimestamp * 1000),
    };
}

export function mapTransactionCreationData(
    tx: TransactionResponse,
    receipt: RpcTransactionReceipt,
    blockTimestamp: number,
    transfer: TransferContextMetadata,
): TransactionCreationAttributes {
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
