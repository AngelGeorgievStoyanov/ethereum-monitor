import { hasCanonicalBlocks } from '../repositories/reorgRecoveryRepository';
import { findCanonicalBlockIdentity } from '../repositories/blockRepository';
import type { CanonicalBlockIdentity } from '../repositories/blockRepository';

let cachedCheckpointNumber: number | null = null;
let cachedCheckpointBlock: CanonicalBlockIdentity | null = null;
let cachedCanonicalHistoryExists: boolean | null = null;

export async function getConfirmedCheckpointBlock(
    checkpoint: number,
): Promise<CanonicalBlockIdentity | null> {
    if (checkpoint < 0) return null;
    if (cachedCheckpointNumber === checkpoint) return cachedCheckpointBlock;

    const block = await findCanonicalBlockIdentity(checkpoint);
    cachedCheckpointNumber = checkpoint;
    cachedCheckpointBlock = block;
    cachedCanonicalHistoryExists = block ? true : null;
    return block;
}

export async function hasCanonicalHistoryForCheckpoint(checkpoint: number): Promise<boolean> {
    await getConfirmedCheckpointBlock(checkpoint);
    if (cachedCheckpointNumber !== checkpoint) return false;

    if (cachedCanonicalHistoryExists === null) {
        cachedCanonicalHistoryExists = await hasCanonicalBlocks();
    }
    return cachedCanonicalHistoryExists;
}

export function cacheConfirmedCheckpointBlock(
    block: CanonicalBlockIdentity | null,
    checkpoint: number,
): void {
    cachedCheckpointNumber = checkpoint;
    cachedCheckpointBlock = block;
    cachedCanonicalHistoryExists = block ? true : null;
}

export function invalidateConfirmedBlockCache(): void {
    cachedCheckpointNumber = null;
    cachedCheckpointBlock = null;
    cachedCanonicalHistoryExists = null;
}
