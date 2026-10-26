import { TransactionResponse } from 'ethers';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import TxFilter from '../models/txFilter';
import { fetchBlockData } from './ethereumRpcService';
import { processNativeTransfers } from './nativeTransferService';
import { processErc20Transfers } from './erc20TransferService';

export interface ProcessedBlockMetrics {
    transactionCount: number;
    nativeTransfersSeen: number;
    nativeMatches: number;
    erc20TransferLogsSeen: number;
    erc20Matches: number;
    erc20FailedAttemptsSeen: number;
    erc20FailedAttemptsMatched: number;
    fetchDurationMs: number;
    fetchAttempts: number;
    blockDurationMs: number;
    nativeDatabaseWriteDurationMs: number;
    erc20DatabaseWriteDurationMs: number;
}

export async function processBlock(
    blockNumber: number,
    activeTxFilters: TxFilter[],
): Promise<ProcessedBlockMetrics> {
    const blockStartedAt = Date.now();
    const { block, receipts, durationMs: fetchDurationMs, attempt } =
        await fetchBlockData(blockNumber);
    const transactions = block.prefetchedTransactions;
    const receiptsByHash = new Map<string, RpcTransactionReceipt>();

    for (const receipt of receipts) {
        receiptsByHash.set(String(receipt.transactionHash).toLowerCase(), receipt);
    }

    const transactionsByHash = new Map<string, TransactionResponse>();
    for (const tx of transactions) {
        transactionsByHash.set(tx.hash.toLowerCase(), tx);
    }

    const native = await processNativeTransfers(
        transactions,
        receiptsByHash,
        activeTxFilters,
        blockNumber,
        block.timestamp,
    );
    const erc20 = await processErc20Transfers(
        receipts,
        transactionsByHash,
        activeTxFilters,
        blockNumber,
        block.timestamp,
    );

    return {
        transactionCount: transactions.length,
        nativeTransfersSeen: native.transfersSeen,
        nativeMatches: native.transfersMatched,
        erc20TransferLogsSeen: erc20.transferLogsSeen,
        erc20Matches: erc20.transfersMatched,
        erc20FailedAttemptsSeen: erc20.failedAttemptsSeen,
        erc20FailedAttemptsMatched: erc20.failedAttemptsMatched,
        fetchDurationMs,
        fetchAttempts: attempt,
        blockDurationMs: Date.now() - blockStartedAt,
        nativeDatabaseWriteDurationMs: native.databaseWriteDurationMs,
        erc20DatabaseWriteDurationMs: erc20.databaseWriteDurationMs,
    };
}
