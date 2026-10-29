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

export class BlockReceiptConsistencyError extends Error {
    constructor(
        public readonly blockNumber: number,
        message: string,
    ) {
        super(message);
        this.name = 'BlockReceiptConsistencyError';
    }
}

function validateBlockReceipts(
    blockNumber: number,
    block: ethers.Block,
    receipts: RpcTransactionReceipt[],
): void {
    if (!block.hash || !block.parentHash) {
        throw new BlockReceiptConsistencyError(
            blockNumber,
            `Block ${blockNumber} is missing its hash or parent hash`,
        );
    }
    const transactions = block.prefetchedTransactions;
    if (receipts.length === 0) {
        if (transactions.length === 0) {
            // Empty blocks legitimately have no receipts, so there is no receipt blockHash to compare.
            return;
        }
        throw new BlockReceiptConsistencyError(
            blockNumber,
            `Block ${blockNumber} contains ${transactions.length} transactions but returned no receipts`,
        );
    }

    const firstReceiptBlockHash = String(receipts[0].blockHash ?? '').toLowerCase();
    const inconsistentReceiptHashes = receipts.some(
        (receipt) => String(receipt.blockHash ?? '').toLowerCase() !== firstReceiptBlockHash,
    );
    if (inconsistentReceiptHashes) {
        const distinctHashes = [
            ...new Set(
                receipts.map(
                    (receipt) => String(receipt.blockHash ?? '').toLowerCase() || '<missing>',
                ),
            ),
        ];
        throw new BlockReceiptConsistencyError(
            blockNumber,
            `Block ${blockNumber} returned inconsistent receipt blockHash values: ${distinctHashes.join(', ')}`,
        );
    }

    if (firstReceiptBlockHash !== block.hash.toLowerCase()) {
        throw new BlockReceiptConsistencyError(
            blockNumber,
            `Block ${blockNumber} hash ${block.hash} does not match receipt blockHash ${receipts[0].blockHash}`,
        );
    }

    if (transactions.length !== receipts.length) {
        throw new BlockReceiptConsistencyError(
            blockNumber,
            `Block ${blockNumber} has ${transactions.length} transactions but ${receipts.length} receipts`,
        );
    }

    const transactionHashes = new Set<string>();
    for (const tx of transactions) {
        const hash = tx.hash.toLowerCase();
        if (transactionHashes.has(hash)) {
            throw new BlockReceiptConsistencyError(
                blockNumber,
                `Block ${blockNumber} contains duplicate transaction ${tx.hash}`,
            );
        }
        transactionHashes.add(hash);
    }

    const receiptHashes = new Set<string>();
    for (const receipt of receipts) {
        const hash = String(receipt.transactionHash).toLowerCase();
        if (receiptHashes.has(hash)) {
            throw new BlockReceiptConsistencyError(
                blockNumber,
                `Block ${blockNumber} contains duplicate receipt for ${hash}`,
            );
        }
        receiptHashes.add(hash);

        if (!transactionHashes.has(hash)) {
            throw new BlockReceiptConsistencyError(
                blockNumber,
                `Receipt ${hash} does not correspond to a transaction in block ${blockNumber}`,
            );
        }
        if (Number(BigInt(receipt.blockNumber)) !== block.number) {
            throw new BlockReceiptConsistencyError(
                blockNumber,
                `Receipt ${hash} has blockNumber ${receipt.blockNumber}, expected ${block.number}`,
            );
        }
    }

    if (receiptHashes.size !== transactionHashes.size) {
        throw new BlockReceiptConsistencyError(
            blockNumber,
            `Block ${blockNumber} transaction and receipt sets do not match`,
        );
    }
}

export async function fetchBlockData(blockNumber: number) {
    for (let attempt = 1; attempt <= MAX_BLOCK_FETCH_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();
        try {
            const {
                block,
                receipts,
                getBlockDurationMs,
                getBlockReceiptsDurationMs,
            } = await ethereumProvider.getBlockAndReceipts(blockNumber);
            validateBlockReceipts(blockNumber, block, receipts);

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
            if (error instanceof BlockReceiptConsistencyError) {
                console.error(`[RPC] Block ${blockNumber} receipt consistency failure: ${message}`);
                throw error;
            }
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
