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

    const blockDurationMs = Date.now() - blockStartedAt;
    const databaseWriteDurationMs =
        native.databaseWriteDurationMs + erc20.databaseWriteDurationMs;

    console.log(
        `[Scanner] Block ${blockNumber} processed: tx=${transactions.length}, ` +
            `native seen=${native.transfersSeen}, native matches=${native.transfersMatched}, ` +
            `ERC-20 logs=${erc20.transferLogsSeen}, ERC-20 matches=${erc20.transfersMatched}, ` +
            `ERC-20 failed attempts=${erc20.failedAttemptsSeen}, ` +
            `failed matches=${erc20.failedAttemptsMatched}, ` +
            `fetch=${fetchDurationMs}ms, db writes=${databaseWriteDurationMs}ms, ` +
            `total=${blockDurationMs}ms` +
            (attempt > 1 ? `, fetch attempts=${attempt}` : ''),
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
        blockDurationMs,
        nativeDatabaseWriteDurationMs: native.databaseWriteDurationMs,
        erc20DatabaseWriteDurationMs: erc20.databaseWriteDurationMs,
    };
}
