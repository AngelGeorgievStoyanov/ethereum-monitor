import { ethers } from 'ethers';
import { configInfura } from '../config/config';

const MAX_BLOCK_FETCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 15000;

export const ethereumProvider = new ethers.JsonRpcProvider(
    `https://mainnet.infura.io/v3/${configInfura.infuraProjectId}`
);

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function fetchBlockData(blockNumber: number) {
    for (let attempt = 1; attempt <= MAX_BLOCK_FETCH_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();

        try {
            const [block, receipts] = await Promise.all([
                ethereumProvider.getBlock(blockNumber, true),
                ethereumProvider.send('eth_getBlockReceipts', [ethers.toQuantity(blockNumber)]),
            ]);

            if (!block) {
                throw new Error(`Unable to load block ${blockNumber}`);
            }
            if (!Array.isArray(receipts)) {
                throw new Error('eth_getBlockReceipts returned a non-array response');
            }

            return { block, receipts, durationMs: Date.now() - startedAt, attempt };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt === MAX_BLOCK_FETCH_ATTEMPTS) {
                console.error(`[RPC] Block ${blockNumber} failed after ${attempt} attempts: ${message}`);
                throw error;
            }

            const delayMs = Math.min(RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)), RETRY_MAX_DELAY_MS);
            console.warn(`[RPC] Block ${blockNumber} fetch failed (attempt ${attempt}/${MAX_BLOCK_FETCH_ATTEMPTS}); retrying in ${delayMs}ms: ${message}`);
            await wait(delayMs);
        }
    }

    throw new Error(`Unable to fetch block data for block ${blockNumber}`);
}
