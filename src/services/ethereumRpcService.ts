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

export async function fetchBlockData(blockNumber: number) {
    for (let attempt = 1; attempt <= MAX_BLOCK_FETCH_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();

        try {
            const { block, receipts } = await ethereumProvider.execute(
                `fetchBlockData(${blockNumber})`,
                async (provider) => {
                    const block = await provider.getBlock(blockNumber, true);

                    if (!block) {
                        throw new Error(`Unable to load block ${blockNumber}`);
                    }

                    const response: unknown = await provider.send('eth_getBlockReceipts', [
                        ethers.toQuantity(blockNumber),
                    ]);

                    if (!Array.isArray(response)) {
                        throw new Error('eth_getBlockReceipts returned a non-array response');
                    }

                    return {
                        block,
                        receipts: response as RpcTransactionReceipt[],
                    };
                },
            );

            return {
                block,
                receipts,
                durationMs: Date.now() - startedAt,
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
