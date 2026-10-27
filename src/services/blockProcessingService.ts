import { TransactionResponse } from 'ethers';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { fetchBlockData } from './ethereumRpcService';
import { processNativeTransfers } from './nativeTransferService';
import { processErc20Transfers } from './erc20TransferService';
import type { TransferBatchCandidate } from './transactionService';

export interface ProcessedBlockMetrics {
    transactionCount: number;
    nativeTransfersSeen: number;
    nativeMatches: number;
    erc20TransferLogsSeen: number;
    erc20Matches: number;
    erc20FailedAttemptsSeen: number;
    erc20FailedAttemptsMatched: number;
    fetchDurationMs: number;
    getBlockDurationMs: number;
    getBlockReceiptsDurationMs: number;
    filterMatchingDurationMs: number;
    fetchAttempts: number;
    blockDurationMs: number;
    databaseWriteDurationMs: number;
}

export interface PreparedBlockResult extends ProcessedBlockMetrics {
    block: { blockNumber: number; blockHash: string; parentHash: string };
    candidates: TransferBatchCandidate[];
}

type ValidatedEthereumBlock = Awaited<ReturnType<typeof fetchBlockData>>['block'] & {
    hash: string;
    parentHash: string;
};

export interface FetchedBlockForProcessing {
    block: ValidatedEthereumBlock;
    receipts: RpcTransactionReceipt[];
    fetchDurationMs: number;
    getBlockDurationMs: number;
    getBlockReceiptsDurationMs: number;
    attempt: number;
}

export async function fetchBlockForProcessing(blockNumber: number): Promise<FetchedBlockForProcessing> {
    const fetched = await fetchBlockData(blockNumber);
    if (!fetched.block.hash || !fetched.block.parentHash) {
        throw new Error(`Block ${blockNumber} is missing its hash or parent hash`);
    }
    return {
        block: fetched.block as ValidatedEthereumBlock,
        receipts: fetched.receipts,
        fetchDurationMs: fetched.durationMs,
        getBlockDurationMs: fetched.getBlockDurationMs,
        getBlockReceiptsDurationMs: fetched.getBlockReceiptsDurationMs,
        attempt: fetched.attempt,
    };
}

export async function processFetchedBlock(
    fetched: FetchedBlockForProcessing,
    activeTxFilters: ActiveTxFilter[],
    includeUnmatched = false,
): Promise<PreparedBlockResult> {
    const blockStartedAt = Date.now();
    const {
        block,
        receipts,
        fetchDurationMs,
        getBlockDurationMs,
        getBlockReceiptsDurationMs,
        attempt,
    } = fetched;
    const blockNumber = block.number;
    const transactions = block.prefetchedTransactions;
    const receiptsByHash = new Map<string, RpcTransactionReceipt>();

    for (const receipt of receipts) {
        receiptsByHash.set(String(receipt.transactionHash).toLowerCase(), receipt);
    }

    const transactionsByHash = new Map<string, TransactionResponse>();

    for (const tx of transactions) {
        transactionsByHash.set(tx.hash.toLowerCase(), tx);
    }

    const filterMatchingStartedAt = Date.now();
    const native = await processNativeTransfers(
        transactions,
        receiptsByHash,
        activeTxFilters,
        blockNumber,
        block.timestamp,
        includeUnmatched,
    );
    const erc20 = await processErc20Transfers(
        receipts,
        transactionsByHash,
        activeTxFilters,
        blockNumber,
        block.timestamp,
        includeUnmatched,
    );
    const filterMatchingDurationMs = Date.now() - filterMatchingStartedAt;

    return {
        block: { blockNumber: block.number, blockHash: block.hash, parentHash: block.parentHash },
        transactionCount: transactions.length,
        nativeTransfersSeen: native.transfersSeen,
        nativeMatches: native.transfersMatched,
        erc20TransferLogsSeen: erc20.transferLogsSeen,
        erc20Matches: erc20.transfersMatched,
        erc20FailedAttemptsSeen: erc20.failedAttemptsSeen,
        erc20FailedAttemptsMatched: erc20.failedAttemptsMatched,
        fetchDurationMs,
        getBlockDurationMs,
        getBlockReceiptsDurationMs,
        filterMatchingDurationMs,
        fetchAttempts: attempt,
        blockDurationMs: Date.now() - blockStartedAt,
        databaseWriteDurationMs: 0,
        candidates: [...native.candidates, ...erc20.candidates],
    };
}

export async function processBlock(
    blockNumber: number,
    activeTxFilters: ActiveTxFilter[],
    includeUnmatched = false,
): Promise<PreparedBlockResult> {
    const fetched = await fetchBlockForProcessing(blockNumber);
    return processFetchedBlock(fetched, activeTxFilters, includeUnmatched);
}
