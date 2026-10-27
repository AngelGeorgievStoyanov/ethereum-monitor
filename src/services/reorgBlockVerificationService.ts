import { BlockVerificationUnavailableError } from '../errors/blockVerificationUnavailableError';
import { ConsensusBlock, getBlockWithConsensus } from './blockConsensusService';
import {
    CONSENSUS_LOG_INTERVAL_MS,
    CONSENSUS_MAX_RETRIES,
    CONSENSUS_RETRY_INTERVAL_MS,
} from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';

function validateSingleProviderBlock(
    block: Awaited<ReturnType<typeof ethereumProvider.getBlock>>,
    requestedBlockNumber: number,
): ConsensusBlock {
    if (!block) {
        throw new Error('Provider returned an empty block');
    }
    if (block.number !== requestedBlockNumber) {
        throw new Error(`Provider returned block ${block.number}, expected ${requestedBlockNumber}`);
    }
    if (!block.hash || !block.parentHash) {
        throw new Error('Provider returned a block without hash or parentHash');
    }

    return {
        blockNumber: block.number,
        blockHash: block.hash,
        parentHash: block.parentHash,
    };
}

/**
 * Verifies blocks specifically for reorg detection and recovery.
 * Multiple providers use strict consensus. A single configured provider is
 * the operational source of truth, so no consensus request is attempted.
 */
export async function getReorgVerifiedBlock(
    blockNumber: number,
    operation: string,
): Promise<ConsensusBlock> {
    if (ethereumProvider.getEndpointCount() !== 1) {
        return getBlockWithConsensus(blockNumber, operation);
    }

    let lastFailure = 'No valid provider response';
    let lastLoggedAt = 0;

    for (let retry = 0; retry <= CONSENSUS_MAX_RETRIES; retry += 1) {
        try {
            const block = await ethereumProvider.getBlock(blockNumber);
            return validateSingleProviderBlock(block, blockNumber);
        } catch (error) {
            lastFailure = formatError(error);
        }

        const now = Date.now();
        if (retry === 0 || now - lastLoggedAt >= CONSENSUS_LOG_INTERVAL_MS) {
            console.warn(
                `[ReorgVerification] Single-provider verification failed for block ${blockNumber} during ${operation}; attempt ${retry + 1}/${CONSENSUS_MAX_RETRIES + 1}; retrying in ${CONSENSUS_RETRY_INTERVAL_MS}ms; provider=P1 reason=${lastFailure}`,
            );
            lastLoggedAt = now;
        }

        if (retry === CONSENSUS_MAX_RETRIES) break;
        await sleep(CONSENSUS_RETRY_INTERVAL_MS);
    }

    const message =
        `Block verification unavailable for block ${blockNumber} during ${operation} after ${CONSENSUS_MAX_RETRIES} retries using the only configured RPC provider: ${lastFailure}`;
    console.error(`[ReorgVerification] CRITICAL ${message}`);
    throw new BlockVerificationUnavailableError(blockNumber, operation, message);
}
