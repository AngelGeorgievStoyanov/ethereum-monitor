import { TransactionResponse } from 'ethers';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';

export interface TransferContextMetadata {
    transferType: 'native' | 'erc20';
    tokenAddress?: string | null;
    logIndex: number;
    from: string;
    to: string;
    value: string;
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
        status: Number(BigInt(receipt.status ?? '0x0')) === 1 ? 'success' : 'failed',
        transactionType: tx.type?.toString() ?? null,
        timestamp: new Date(blockTimestamp * 1000),
    };
}
