import { ethers, TransactionResponse } from 'ethers';
import Configuration from '../models/configuration';
import { createTransactionFromEthereumData } from './transactionService';
import { matchesConfiguration } from '../utils/matchesConfiguration';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)').toLowerCase();

export async function processErc20Transfers(
    receipts: any[],
    transactionsByHash: Map<string, TransactionResponse>,
    configurations: Configuration[],
    blockNumber: number,
    blockTimestamp: number
) {
    let transferLogsSeen = 0;
    let transfersMatched = 0;
    let databaseWriteDurationMs = 0;

    for (const receipt of receipts) {
        if (Number(BigInt(receipt.status ?? '0x0')) !== 1) continue;

        const txHash = String(receipt.transactionHash).toLowerCase();
        const tx = transactionsByHash.get(txHash);
        if (!tx) {
            throw new Error(`Block transaction ${receipt.transactionHash} was not found in block ${blockNumber}`);
        }

        for (const log of receipt.logs ?? []) {
            if (
                !Array.isArray(log.topics)
                || log.topics.length !== 3
                || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC
                || !/^0x[0-9a-fA-F]{40}$/.test(String(log.address))
            ) {
                continue;
            }

            transferLogsSeen += 1;
            const from = ethers.getAddress(`0x${String(log.topics[1]).slice(-40)}`);
            const to = ethers.getAddress(`0x${String(log.topics[2]).slice(-40)}`);
            const value = BigInt(log.data).toString();
            const logIndex = Number(BigInt(log.logIndex));

            const matchingConfigurations = configurations.filter(config =>
                config.isActive
                && matchesConfiguration(from, to, config)
            );

            for (const config of matchingConfigurations) {
                const startedAt = Date.now();
                await createTransactionFromEthereumData(
                    tx,
                    receipt,
                    config,
                    blockTimestamp,
                    {
                        transferType: 'erc20',
                        tokenAddress: ethers.getAddress(log.address),
                        logIndex,
                        from,
                        to,
                        value,
                    }
                );
                databaseWriteDurationMs += Date.now() - startedAt;
                transfersMatched += 1;
            }
        }
    }

    return { transferLogsSeen, transfersMatched, databaseWriteDurationMs };
}
