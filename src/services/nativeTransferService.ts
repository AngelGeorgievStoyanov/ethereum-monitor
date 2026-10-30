import { TransactionResponse } from 'ethers';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { RpcTransactionReceipt } from '../types/evm-rpc.types';
import { matchesTxFilter } from '../utils/matchesTxFilter';
import { mapTransactionFilterContext } from '../mappers/transactionContextMapper';
import type { TransferBatchCandidate } from '../types/transfer-batch.types';

export interface ProcessNativeTransfersOptions {
    transactions: readonly TransactionResponse[];
    receiptsByHash: Map<string, RpcTransactionReceipt>;
    txFilters: ActiveTxFilter[];
    blockNumber: number;
    blockTimestamp: number;
    includeUnmatched?: boolean;
}

export async function processNativeTransfers({
    transactions,
    receiptsByHash,
    txFilters,
    blockNumber,
    blockTimestamp,
    includeUnmatched = false,
}: ProcessNativeTransfersOptions) {
    let transfersSeen = 0;
    let transfersMatched = 0;
    const candidates: TransferBatchCandidate[] = [];

    for (const tx of transactions) {
        if (!tx.to || tx.value <= 0n) continue;

        const receipt = receiptsByHash.get(tx.hash.toLowerCase());
        if (!receipt) {
            throw new Error(
                `Block receipts did not contain native transaction ${tx.hash} in block ${blockNumber}`,
            );
        }

        // Keep failed attempts too; the receipt status is persisted as "failed".
        // This records the attempted value without treating it as a successful transfer.
        transfersSeen += 1;

        const transfer = {
            transferType: 'native' as const,
            logIndex: -1,
            from: tx.from,
            to: tx.to,
            value: tx.value.toString(),
        };
        const context = mapTransactionFilterContext(
            tx,
            receipt,
            blockNumber,
            blockTimestamp,
            transfer,
        );

        const matchingTxFilters = txFilters.filter((filter) => matchesTxFilter(context, filter));
        if (matchingTxFilters.length === 0 && !includeUnmatched) continue;

        candidates.push({
            tx,
            receipt,
            blockTimestamp,
            transfer,
            matchingTxFilters,
        });
        transfersMatched += 1;
    }

    return { transfersSeen, transfersMatched, candidates };
}
