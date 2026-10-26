import { TransactionResponse } from 'ethers';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { createTransactionFromEthereumData } from './transactionService';
import { matchesTxFilter } from '../utils/matchesTxFilter';
import { mapTransactionFilterContext } from '../mappers/transactionContextMapper';
import type { TransferBatchCandidate } from './transactionService';

export async function processNativeTransfers(
    transactions: readonly TransactionResponse[],
    receiptsByHash: Map<string, RpcTransactionReceipt>,
    txFilters: ActiveTxFilter[],
    blockNumber: number,
    blockTimestamp: number,
) {
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

        // A failed transaction does not transfer its requested ETH value to the recipient.
        if (Number(BigInt(receipt.status ?? '0x0')) !== 1) continue;
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

        const matchingTxFilters = txFilters.filter((filter) =>
            matchesTxFilter(context, filter, blockNumber),
        );
        if (matchingTxFilters.length === 0) continue;

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
