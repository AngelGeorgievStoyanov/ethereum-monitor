import { ethers, TransactionResponse } from 'ethers';
import TxFilter from '../models/txFilter';
import { ERC20_TRANSFER_TOPIC } from '../constants/erc20-transfer.constants';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { createTransactionFromEthereumData } from './transactionService';
import { matchesTxFilter } from '../utils/matchesTxFilter';

const ERC20_INTERFACE = new ethers.Interface([
    'function transfer(address to, uint256 value)',
    'function transferFrom(address from, address to, uint256 value)',
]);

interface Erc20TransferAttempt {
    from: string;
    to: string;
    value: string;
}

function decodeFailedErc20TransferAttempt(
    tx: TransactionResponse,
): Erc20TransferAttempt | undefined {
    if (!tx.to) return undefined;

    let parsed;
    try {
        parsed = ERC20_INTERFACE.parseTransaction({ data: tx.data });
    } catch {
        return undefined;
    }

    if (!parsed) return undefined;

    if (parsed.name === 'transfer') {
        return {
            from: ethers.getAddress(tx.from),
            to: ethers.getAddress(String(parsed.args[0])),
            value: BigInt(parsed.args[1]).toString(),
        };
    }

    if (parsed.name === 'transferFrom') {
        return {
            from: ethers.getAddress(String(parsed.args[0])),
            to: ethers.getAddress(String(parsed.args[1])),
            value: BigInt(parsed.args[2]).toString(),
        };
    }

    return undefined;
}

export async function processErc20Transfers(
    receipts: readonly RpcTransactionReceipt[],
    transactionsByHash: Map<string, TransactionResponse>,
    txFilters: TxFilter[],
    blockNumber: number,
    blockTimestamp: number,
) {
    let transferLogsSeen = 0;
    let transfersMatched = 0;
    let failedAttemptsSeen = 0;
    let failedAttemptsMatched = 0;
    let databaseWriteDurationMs = 0;

    for (const receipt of receipts) {
        const txHash = receipt.transactionHash.toLowerCase();
        const tx = transactionsByHash.get(txHash);
        if (!tx) {
            throw new Error(
                `Block transaction ${receipt.transactionHash} was not found in block ${blockNumber}`,
            );
        }

        if (Number(BigInt(receipt.status ?? '0x0')) !== 1) {
            const attempt = decodeFailedErc20TransferAttempt(tx);
            if (!attempt) continue;

            failedAttemptsSeen += 1;
            const matchingTxFilters = txFilters.filter(
                (txFilter) =>
                    txFilter.isActive && matchesTxFilter(attempt.from, attempt.to, config),
            );

            for (const txFilter of matchingTxFilters) {
                const startedAt = Date.now();
                await createTransactionFromEthereumData(tx, receipt, txFilter, blockTimestamp, {
                    transferType: 'erc20',
                    tokenAddress: ethers.getAddress(tx.to!),
                    logIndex: -1,
                    from: attempt.from,
                    to: attempt.to,
                    value: attempt.value,
                });
                databaseWriteDurationMs += Date.now() - startedAt;
                failedAttemptsMatched += 1;
            }

            continue;
        }

        for (const log of receipt.logs ?? []) {
            if (
                !Array.isArray(log.topics) ||
                log.topics.length !== 3 ||
                log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC ||
                !/^0x[0-9a-fA-F]{40}$/.test(log.address)
            ) {
                continue;
            }

            transferLogsSeen += 1;
            const from = ethers.getAddress(`0x${log.topics[1].slice(-40)}`);
            const to = ethers.getAddress(`0x${log.topics[2].slice(-40)}`);
            const value = BigInt(log.data).toString();
            const logIndex = Number(BigInt(log.logIndex));

            const matchingTxFilters = txFilters.filter(
                (txFilter) => txFilter.isActive && matchesTxFilter(from, to, config),
            );

            for (const txFilter of matchingTxFilters) {
                const startedAt = Date.now();
                await createTransactionFromEthereumData(tx, receipt, txFilter, blockTimestamp, {
                    transferType: 'erc20',
                    tokenAddress: ethers.getAddress(log.address),
                    logIndex,
                    from,
                    to,
                    value,
                });
                databaseWriteDurationMs += Date.now() - startedAt;
                transfersMatched += 1;
            }
        }
    }

    return {
        transferLogsSeen,
        transfersMatched,
        failedAttemptsSeen,
        failedAttemptsMatched,
        databaseWriteDurationMs,
    };
}
