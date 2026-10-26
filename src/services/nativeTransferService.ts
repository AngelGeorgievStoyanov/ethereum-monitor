import { TransactionResponse } from 'ethers';
import TxFilter from '../models/txFilter';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { createTransactionFromEthereumData } from './transactionService';
import { matchesTxFilter } from '../utils/matchesTxFilter';

export async function processNativeTransfers(
    transactions: readonly TransactionResponse[],
    receiptsByHash: Map<string, RpcTransactionReceipt>,
    txFilters: TxFilter[],
    blockNumber: number,
    blockTimestamp: number,
) {
    let transfersSeen = 0;
    let transfersMatched = 0;
    let databaseWriteDurationMs = 0;

    for (const tx of transactions) {
        if (!tx.to || tx.value <= 0n) continue;
        transfersSeen += 1;

        const matchingTxFilters = txFilters.filter(
            (txFilter) => txFilter.isActive && matchesTxFilter(tx.from, tx.to, txFilter),
        );
        if (matchingTxFilters.length === 0) continue;

        const receipt = receiptsByHash.get(tx.hash.toLowerCase());
        if (!receipt) {
            throw new Error(
                `Block receipts did not contain native transaction ${tx.hash} in block ${blockNumber}`,
            );
        }

        const startedAt = Date.now();
        await createTransactionFromEthereumData(
            tx,
            receipt,
            blockTimestamp,
            {
                transferType: 'native',
                logIndex: -1,
                from: tx.from,
                to: tx.to,
                value: tx.value.toString(),
            },
            matchingTxFilters,
        );
        databaseWriteDurationMs += Date.now() - startedAt;
        transfersMatched += 1;
    }

    return { transfersSeen, transfersMatched, databaseWriteDurationMs };
}
