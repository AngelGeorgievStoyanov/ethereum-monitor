import { TransactionResponse } from 'ethers';
import Configuration from '../models/configuration';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { createTransactionFromEthereumData } from './transactionService';
import { matchesConfiguration } from '../utils/matchesConfiguration';

export async function processNativeTransfers(
    transactions: readonly TransactionResponse[],
    receiptsByHash: Map<string, RpcTransactionReceipt>,
    configurations: Configuration[],
    blockNumber: number,
    blockTimestamp: number,
) {
    let transfersSeen = 0;
    let transfersMatched = 0;
    let databaseWriteDurationMs = 0;

    for (const tx of transactions) {
        if (!tx.to || tx.value <= 0n) continue;
        transfersSeen += 1;

        const matchingConfigurations = configurations.filter(
            (config) => config.isActive && matchesConfiguration(tx.from, tx.to, config),
        );
        if (matchingConfigurations.length === 0) continue;

        const receipt = receiptsByHash.get(tx.hash.toLowerCase());
        if (!receipt) {
            throw new Error(
                `Block receipts did not contain native transaction ${tx.hash} in block ${blockNumber}`,
            );
        }

        for (const config of matchingConfigurations) {
            const startedAt = Date.now();
            await createTransactionFromEthereumData(tx, receipt, config, blockTimestamp, {
                transferType: 'native',
                logIndex: -1,
                from: tx.from,
                to: tx.to,
                value: tx.value.toString(),
            });
            databaseWriteDurationMs += Date.now() - startedAt;
            transfersMatched += 1;
        }
    }

    return { transfersSeen, transfersMatched, databaseWriteDurationMs };
}
