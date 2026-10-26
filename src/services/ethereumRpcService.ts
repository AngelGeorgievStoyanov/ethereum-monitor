import { ethers } from 'ethers';
import {
    MAX_BLOCK_FETCH_ATTEMPTS,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_DELAY_MS,
} from '../constants/ethereum-rpc.constants';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';
import { getRpcClient } from '../clients/rpcClient';

export const ethereumProvider = getRpcClient();

function validateBlockReceipts(
    blockNumber: number,
    block: ethers.Block,
    receipts: RpcTransactionReceipt[],
): void {
    const transactions = block.prefetchedTransactions;
    if (transactions.length !== receipts.length) {
        throw new Error(
            `Block ${blockNumber} has ${transactions.length} transactions but ${receipts.length} receipts`,
        );
    }

    const transactionHashes = new Set<string>();
    for (const tx of transactions) {
        const hash = tx.hash.toLowerCase();
        if (transactionHashes.has(hash)) {
            throw new Error(`Block ${blockNumber} contains duplicate transaction ${tx.hash}`);
        }
        transactionHashes.add(hash);
    }

    const receiptHashes = new Set<string>();
    for (const receipt of receipts) {
        const hash = String(receipt.transactionHash).toLowerCase();
        if (receiptHashes.has(hash)) {
            throw new Error(`Block ${blockNumber} contains duplicate receipt for ${hash}`);
        }
        receiptHashes.add(hash);

        if (!transactionHashes.has(hash)) {
            throw new Error(
                `Receipt ${hash} does not correspond to a transaction in block ${blockNumber}`,
            );
        }
        if (String(receipt.blockHash).toLowerCase() !== block.hash.toLowerCase()) {
            throw new Error(
                `Receipt ${hash} has blockHash ${receipt.blockHash}, expected ${block.hash}`,
            );
        }
        if (Number(BigInt(receipt.blockNumber)) !== block.number) {
            throw new Error(
                `Receipt ${hash} has blockNumber ${receipt.blockNumber}, expected ${block.number}`,
            );
        }
    }

    if (receiptHashes.size !== transactionHashes.size) {
        throw new Error(`Block ${blockNumber} transaction and receipt sets do not match`);
    }
}

export async function fetchBlockData(blockNumber: number) {
    for (let attempt = 1; attempt <= MAX_BLOCK_FETCH_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();
        let getBlockDurationMs = 0;
        let getBlockReceiptsDurationMs = 0;

        try {
            const { block, receipts } = await ethereumProvider.execute(
                `fetchBlockData(${blockNumber})`,
                async (provider) => {
                    const getBlockStartedAt = Date.now();
                    const block = await provider.getBlock(blockNumber, true);
                    getBlockDurationMs = Date.now() - getBlockStartedAt;

                    if (!block) {
                        throw new Error(`Unable to load block ${blockNumber}`);
                    }

                    const getReceiptsStartedAt = Date.now();
                    const response: unknown = await provider.send('eth_getBlockReceipts', [
                        ethers.toQuantity(blockNumber),
                    ]);
                    getBlockReceiptsDurationMs = Date.now() - getReceiptsStartedAt;

                    if (!Array.isArray(response)) {
                        throw new Error('eth_getBlockReceipts returned a non-array response');
                    }

                    const receipts = response as RpcTransactionReceipt[];
                    validateBlockReceipts(blockNumber, block, receipts);

                    return {
                        block,
                        receipts,
                    };
                },
            );

            return {
                block,
                receipts,
                durationMs: Date.now() - startedAt,
                getBlockDurationMs,
                getBlockReceiptsDurationMs,
                attempt,
            };
        } catch (error) {
            const message = formatError(error);
            if (attempt === MAX_BLOCK_FETCH_ATTEMPTS) {
                console.error(
                    `[RPC] Block ${blockNumber} failed after ${attempt} attempts: ${message}`,
                );
                throw error;
            }

            const delayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
            console.warn(
                `[RPC] Block ${blockNumber} fetch failed (attempt ${attempt}/${MAX_BLOCK_FETCH_ATTEMPTS}); retrying in ${delayMs}ms: ${message}`,
            );
            await sleep(delayMs);
        }
    }

    throw new Error(`Unable to fetch block data for block ${blockNumber}`);
}
