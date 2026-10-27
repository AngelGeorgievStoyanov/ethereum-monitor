import { BlockVerificationUnavailableError } from '../errors/blockVerificationUnavailableError';
import {
    CONSENSUS_LOG_INTERVAL_MS,
    CONSENSUS_MAX_RETRIES,
    CONSENSUS_RETRY_INTERVAL_MS,
} from '../constants/scanner.constants';
import { ethereumProvider } from './ethereumRpcService';
import { sleep } from '../utils/sleep';

export interface ConsensusBlock {
    blockNumber: number;
    blockHash: string;
    parentHash: string;
}

export class ConsensusUnavailableError extends BlockVerificationUnavailableError {
    constructor(blockNumber: number, operation: string, message: string) {
        super(blockNumber, operation, message);
        this.name = 'ConsensusUnavailableError';
    }
}

function describeDisagreement(
    expected: ConsensusBlock | undefined,
    result: Awaited<ReturnType<typeof ethereumProvider.getBlockFromAllEndpoints>>[number],
    requestedBlockNumber: number,
): string {
    if (result.error) return `provider=P${result.endpointIndex} reason=${result.error}`;
    if (!result.block) return `provider=P${result.endpointIndex} reason=EMPTY_BLOCK`;
    if (result.block.number !== requestedBlockNumber) {
        return `provider=P${result.endpointIndex} reason=HEIGHT_MISMATCH received=${result.block.number} expected=${requestedBlockNumber}`;
    }
    if (!result.block.hash || !result.block.parentHash) {
        return `provider=P${result.endpointIndex} reason=MISSING_BLOCK_HASH`;
    }
    if (expected && result.block.hash.toLowerCase() !== expected.blockHash.toLowerCase()) {
        return `provider=P${result.endpointIndex} reason=HASH_MISMATCH expected=${expected.blockHash} received=${result.block.hash}`;
    }
    if (expected && result.block.parentHash.toLowerCase() !== expected.parentHash.toLowerCase()) {
        return `provider=P${result.endpointIndex} reason=PARENT_HASH_MISMATCH expected=${expected.parentHash} received=${result.block.parentHash}`;
    }
    return '';
}

export async function getBlockWithConsensus(
    blockNumber: number,
    operation: string,
): Promise<ConsensusBlock> {
    let lastLoggedAt = 0;
    let lastDisagreements: string[] = [];

    for (let retry = 0; retry <= CONSENSUS_MAX_RETRIES; retry += 1) {
        const results = await ethereumProvider.getBlockFromAllEndpoints(blockNumber);
        const firstBlock = results.find((result) => result.block && result.block.hash && result.block.parentHash)?.block;
        const expected: ConsensusBlock | undefined = firstBlock
            ? { blockNumber: firstBlock.number, blockHash: firstBlock.hash!, parentHash: firstBlock.parentHash }
            : undefined;
        const disagreements = results.map((result) => describeDisagreement(expected, result, blockNumber)).filter(Boolean);

        if (expected && disagreements.length === 0 && results.length === ethereumProvider.getEndpointCount()) {
            return expected;
        }

        lastDisagreements = disagreements.length > 0 ? disagreements : ['No valid provider response'];
        const now = Date.now();
        if (retry === 0 || now - lastLoggedAt >= CONSENSUS_LOG_INTERVAL_MS) {
            console.warn(
                `[Consensus] ${operation} failed for block ${blockNumber}; attempt ${retry + 1}/${CONSENSUS_MAX_RETRIES + 1}; retrying in ${CONSENSUS_RETRY_INTERVAL_MS}ms; ${lastDisagreements.join('; ')}`,
            );
            lastLoggedAt = now;
        }

        if (retry === CONSENSUS_MAX_RETRIES) break;
        await sleep(CONSENSUS_RETRY_INTERVAL_MS);
    }

    const message = `Consensus unavailable for block ${blockNumber} during ${operation} after ${CONSENSUS_MAX_RETRIES} retries: ${lastDisagreements.join('; ')}`;
    console.error(`[Consensus] CRITICAL ${message}`);
    throw new ConsensusUnavailableError(blockNumber, operation, message);
}
