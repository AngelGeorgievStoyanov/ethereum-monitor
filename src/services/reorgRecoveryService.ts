import {
    MAX_REORG_LOOKBACK_BLOCKS,
    REORG_RECOVERY_STABLE_BLOCKS,
    SCANNER_ID,
} from '../constants/scanner.constants';
import type { ScannerRuntimeState } from '../types/scanner-state.types';
import { refreshScannerState } from './scannerStateService';
import {
    hasCanonicalBlocks,
    markReorgRecoveryBlocked,
    markReorgRecoveryPending as persistReorgRecoveryPending,
    rollbackToCommonAncestor,
} from '../repositories/reorgRecoveryRepository';
import { fetchBlockForProcessing, processFetchedBlock } from './blockProcessingService';
import { BlockVerificationUnavailableError } from '../errors/blockVerificationUnavailableError';
import { ConsensusUnavailableError } from './blockConsensusService';
import { getReorgVerifiedBlock } from './reorgBlockVerificationService';
import { BlockReceiptConsistencyError, ethereumProvider } from './ethereumRpcService';
import { persistProcessedBlockBatch } from './scannerPersistenceService';
import type { ActiveTxFilter } from '../types/tx-filter.types';
import { isScannerLockHeld } from './scannerLockService';
import { findCanonicalBlockIdentity } from '../repositories/blockRepository';
import { findScannerStatusState, unblockScannerReorgRecovery } from '../repositories/scannerStateRepository';
import { mapReorgRecoveryRetryResponse } from '../mappers/scannerControlMapper';
import {
    recordReorgAncestorFound,
    recordReorgBlockReprocessed,
    recordReorgConsensusFailure,
    recordReorgDetected,
    recordReorgRecoveryCompleted,
} from './recoveryMetrics';

export type RetryBlockedReorgRecoveryResult =
    | { kind: 'no-pending-recovery' }
    | { kind: 'recovery-not-blocked' }
    | { kind: 'state-changed' }
    | { kind: 'unblocked'; response: ReturnType<typeof mapReorgRecoveryRetryResponse> };

export async function retryBlockedReorgRecovery(): Promise<RetryBlockedReorgRecoveryResult> {
    const state = await findScannerStatusState(SCANNER_ID);
    if (!state || !state.reorgRecoveryActive) return { kind: 'no-pending-recovery' };
    if (!state.reorgRecoveryBlocked) return { kind: 'recovery-not-blocked' };

    const unblocked = await unblockScannerReorgRecovery(SCANNER_ID);
    if (!unblocked) return { kind: 'state-changed' };

    return { kind: 'unblocked', response: mapReorgRecoveryRetryResponse(state) };
}

class ReorgRecoverySafetyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReorgRecoverySafetyError';
    }
}

let singleProviderReorgWarningLogged = false;

function logSingleProviderReorgMode(): void {
    if (ethereumProvider.getEndpointCount() !== 1 || singleProviderReorgWarningLogged) return;
    console.warn(
        '[Reorg] WARNING: Only one RPC provider is configured. Independent consensus is unavailable; provider P1 is the source of truth for reorg detection and recovery. Consensus verification is disabled.',
    );
    singleProviderReorgWarningLogged = true;
}

function sameBlock(stored: { blockHash: string; parentHash: string }, current: { blockHash: string; parentHash: string }): boolean {
    return (
        stored.blockHash.toLowerCase() === current.blockHash.toLowerCase() &&
        stored.parentHash.toLowerCase() === current.parentHash.toLowerCase()
    );
}

export async function markReorgRecoveryPending(
    scannerStateId: string,
    checkpoint: number,
    targetBlock = checkpoint + REORG_RECOVERY_STABLE_BLOCKS,
): Promise<void> {
    if (!(await isScannerLockHeld()))
        throw new Error('Cannot mark reorg recovery pending without owning the scanner lock');
    await persistReorgRecoveryPending(scannerStateId, checkpoint, targetBlock);
}

async function findAncestorAndRollback(state: ScannerRuntimeState): Promise<void> {
    if (!(await isScannerLockHeld()))
        throw new Error('Cannot search for or roll back a reorg without owning the scanner lock');
    const originalCheckpoint = state.reorgRecoveryStartBlock;
    if (originalCheckpoint === null)
        throw new Error('Reorg recovery has no checkpoint to reconcile');

    console.warn(`[Reorg] Searching for a common ancestor at or below block ${originalCheckpoint}`);
    let ancestor: { blockNumber: number; blockHash: string; parentHash: string } | null = null;
    let ancestorDepth = 0;

    for (let depth = 0; depth <= MAX_REORG_LOOKBACK_BLOCKS; depth += 1) {
        const blockNumber = originalCheckpoint - depth;
        if (blockNumber < 0) break;

        const storedBlock = await findCanonicalBlockIdentity(blockNumber);
        if (!storedBlock) {
            throw new ReorgRecoverySafetyError(
                `Cannot safely recover reorg at block ${originalCheckpoint}: block history is missing at ${blockNumber}`,
            );
        }

        const currentBlock = await getReorgVerifiedBlock(blockNumber, 'common ancestor search');
        if (sameBlock(storedBlock, currentBlock)) {
            ancestor = storedBlock;
            ancestorDepth = depth;
            break;
        }
    }

    if (!ancestor) {
        throw new ReorgRecoverySafetyError(
            `No common ancestor found within ${MAX_REORG_LOOKBACK_BLOCKS} blocks at or below ${originalCheckpoint}`,
        );
    }

    if (!(await isScannerLockHeld()))
        throw new Error('Scanner lock ownership was lost before reorg rollback');
    const rollback = await rollbackToCommonAncestor({
        scannerStateId: state.id,
        expectedCheckpoint: originalCheckpoint,
        ancestorBlockNumber: ancestor.blockNumber,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });

    await refreshScannerState(state);
    recordReorgAncestorFound(ancestorDepth);
    console.warn(
        `[Reorg] Common ancestor=${ancestor.blockNumber}; marked ${rollback.orphanedBlockCount} block(s) as reorged; checkpoint rolled back to ${rollback.checkpoint}`,
    );
}

async function processReorgRecoveryInternal(
    state: ScannerRuntimeState,
    finalizedBlockNumber: number,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<boolean> {
    await refreshScannerState(state);
    if (!(await isScannerLockHeld())) {
        console.warn('[Reorg] Scanner lock is not held; recovery will wait for ownership');
        return true;
    }
    if (state.reorgRecoveryBlocked) return true;
    if (state.reorgRecoveryActive) logSingleProviderReorgMode();
    if (state.lastProcessedBlock < 0 && !state.reorgRecoveryActive) return false;

    if (state.reorgRecoveryActive && state.reorgRecoveryStartBlock !== null) {
        await findAncestorAndRollback(state);
    } else if (!state.reorgRecoveryActive) {
        const storedCheckpoint = await findCanonicalBlockIdentity(state.lastProcessedBlock);
        if (!storedCheckpoint) {
            if (!(await hasCanonicalBlocks())) return false; // Fresh scanner baseline: no block has been persisted yet.
            throw new ReorgRecoverySafetyError(
                `Canonical block history is missing at checkpoint ${state.lastProcessedBlock}`,
            );
        }

        // Cheaply check the checkpoint with the selected provider during normal scanning.
        // If it disagrees, the verification service selects single-provider verification or strict consensus.
        const currentCheckpoint = await ethereumProvider.getBlock(state.lastProcessedBlock);
        if (!currentCheckpoint)
            throw new Error(`Unable to read checkpoint block ${state.lastProcessedBlock}`);
        const primaryMatches = sameBlock(storedCheckpoint, {
            blockHash: currentCheckpoint.hash ?? '',
            parentHash: currentCheckpoint.parentHash,
        });
        if (primaryMatches) return false;

        const verifiedCheckpoint = await getReorgVerifiedBlock(
            state.lastProcessedBlock,
            'reorg detection',
        );
        if (sameBlock(storedCheckpoint, verifiedCheckpoint)) {
            console.warn(
                ethereumProvider.getEndpointCount() === 1
                    ? `[Reorg] Provider P1's follow-up read matches stored history at checkpoint ${state.lastProcessedBlock}; continuing normal scan`
                    : `[Reorg] Primary provider disagreed at checkpoint ${state.lastProcessedBlock}, but configured providers agree with stored history; continuing normal scan`,
            );
            return false;
        }

        logSingleProviderReorgMode();
        console.error(
            `[Reorg] Detected chain mismatch at block ${state.lastProcessedBlock}; storedHash=${storedCheckpoint.blockHash}; currentHash=${currentCheckpoint.hash}`,
        );
        recordReorgDetected();
        await markReorgRecoveryPending(state.id, state.lastProcessedBlock);
        await refreshScannerState(state);
        await findAncestorAndRollback(state);
    }

    if (!state.reorgRecoveryActive) return true;
    const filters = getActiveTxFilters();
    if (filters.length === 0) {
        console.warn('[Reorg] Recovery is paused because there are no active transaction filters');
        return true;
    }

    while (state.reorgRecoveryActive && state.lastProcessedBlock < finalizedBlockNumber) {
        if (!(await isScannerLockHeld())) {
            console.warn(
                '[Reorg] Scanner lock lost; recovery will resume after the lock is reacquired',
            );
            return true;
        }

        const blockNumber = state.lastProcessedBlock + 1;
        const verifiedBlock = await getReorgVerifiedBlock(blockNumber, 'reorg recovery');
        const previousCanonicalBlock = await findCanonicalBlockIdentity(state.lastProcessedBlock);
        if (
            previousCanonicalBlock &&
            verifiedBlock.parentHash.toLowerCase() !==
                previousCanonicalBlock.blockHash.toLowerCase()
        ) {
            console.warn(
                `[Reorg] Chain changed again during recovery at block ${blockNumber}; restarting ancestor search`,
            );
            recordReorgDetected();
            await markReorgRecoveryPending(
                state.id,
                state.lastProcessedBlock,
                blockNumber + REORG_RECOVERY_STABLE_BLOCKS,
            );
            await refreshScannerState(state);
            await findAncestorAndRollback(state);
            continue;
        }

        const fetched = await fetchBlockForProcessing(blockNumber);
        if (
            fetched.block.number !== verifiedBlock.blockNumber ||
            fetched.block.hash.toLowerCase() !== verifiedBlock.blockHash.toLowerCase() ||
            fetched.block.parentHash.toLowerCase() !== verifiedBlock.parentHash.toLowerCase()
        ) {
            throw new ReorgRecoverySafetyError(
                `Block data fetched for recovery block ${blockNumber} does not match the verified provider block`,
            );
        }
        const prepared = await processFetchedBlock(fetched, filters, true);

        const recoveryTargetBlock =
            state.reorgRecoveryTargetBlock ??
            state.lastProcessedBlock + REORG_RECOVERY_STABLE_BLOCKS;
        const stableBlocks =
            blockNumber > recoveryTargetBlock - REORG_RECOVERY_STABLE_BLOCKS
                ? state.reorgRecoveryStableBlocks + 1
                : 0;
        const recoveryComplete = blockNumber >= recoveryTargetBlock;
        if (!(await isScannerLockHeld())) {
            console.warn(
                `[Reorg] Scanner lock lost before committing recovery block ${blockNumber}`,
            );
            return true;
        }
        const committedCheckpoint = await persistProcessedBlockBatch({
            candidates: prepared.candidates,
            blocks: [prepared.block],
            scannerStateId: state.id,
            expectedCheckpoint: state.lastProcessedBlock,
            newCheckpoint: blockNumber,
            recoveryProgress: {
                active: !recoveryComplete,
                stableBlocks: recoveryComplete ? 0 : stableBlocks,
                startBlock: null,
                targetBlock: recoveryComplete ? null : recoveryTargetBlock,
            },
        });
        if (committedCheckpoint !== blockNumber) {
            await refreshScannerState(state);
            continue;
        }

        state.lastProcessedBlock = blockNumber;
        recordReorgBlockReprocessed();
        state.reorgRecoveryActive = !recoveryComplete;
        state.reorgRecoveryStableBlocks = recoveryComplete ? 0 : stableBlocks;
        state.reorgRecoveryStartBlock = null;
        state.reorgRecoveryTargetBlock = recoveryComplete ? null : recoveryTargetBlock;
        console.log(
            `[Reorg] Recovery block ${blockNumber} committed after provider verification; stable=${stableBlocks}/${REORG_RECOVERY_STABLE_BLOCKS}; target=${recoveryTargetBlock}; checkpoint=${state.lastProcessedBlock}`,
        );
        if (recoveryComplete) {
            recordReorgRecoveryCompleted();
            singleProviderReorgWarningLogged = false;
            console.log(
                `[Reorg] Recovery completed at block ${blockNumber}; normal scanner mode may resume`,
            );
            return true;
        }
    }

    return true;
}

async function markVerificationRecoveryBlocked(
    state: ScannerRuntimeState,
    error: BlockVerificationUnavailableError,
): Promise<void> {
    if (!(await isScannerLockHeld())) {
        console.error(
            '[Reorg] Cannot persist blocked recovery state because scanner lock ownership was lost',
        );
        return;
    }
    if (error instanceof ConsensusUnavailableError) recordReorgConsensusFailure();
    if (!(await isScannerLockHeld()))
        throw new Error('Scanner lock ownership was lost before persisting block-verification-blocked recovery state');
    const reasonPrefix =
        error instanceof ConsensusUnavailableError
            ? 'CONSENSUS_UNAVAILABLE'
            : 'BLOCK_VERIFICATION_UNAVAILABLE';
    await markReorgRecoveryBlocked({
        scannerStateId: state.id,
        reason: `${reasonPrefix}:${error.operation}:block=${error.blockNumber}`,
        initializeRecovery: true,
        preserveStartBlock: true,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });
    await refreshScannerState(state);
    console.error(
        `[Reorg] CRITICAL: recovery is blocked because block verification failed; block=${error.blockNumber}; operation=${error.operation}; reason=${error.message}. Explicit operator retry is required.`,
    );
}

async function markReceiptConsistencyRecoveryBlocked(
    state: ScannerRuntimeState,
    error: BlockReceiptConsistencyError,
): Promise<void> {
    if (!(await isScannerLockHeld())) {
        console.error(
            '[Reorg] Cannot persist receipt-consistency-blocked recovery because scanner lock ownership was lost',
        );
        return;
    }

    if (!(await isScannerLockHeld()))
        throw new Error('Scanner lock ownership was lost before persisting receipt-consistency-blocked recovery');
    await markReorgRecoveryBlocked({
        scannerStateId: state.id,
        reason: `RECEIPT_CONSISTENCY:block=${error.blockNumber}:${error.message}`,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });

    await refreshScannerState(state);
    console.error(
        `[Reorg] CRITICAL: recovery blocked after receipt inconsistency at block ${error.blockNumber}. Automatic retries stopped; check RPC provider consistency before explicitly retrying recovery.`,
    );
}

export async function processReorgRecovery(
    state: ScannerRuntimeState,
    finalizedBlockNumber: number,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<boolean> {
    try {
        return await processReorgRecoveryInternal(state, finalizedBlockNumber, getActiveTxFilters);
    } catch (error) {
        if (error instanceof BlockVerificationUnavailableError) {
            await markVerificationRecoveryBlocked(state, error);
        } else if (error instanceof ReorgRecoverySafetyError) {
            await markRecoverySafetyBlocked(state, error);
        } else if (error instanceof BlockReceiptConsistencyError) {
            console.error(
                `[Reorg] Receipt consistency failure during recovery at block ${error.blockNumber}: ${error.message}`,
            );
            recordReorgDetected();
            await markReceiptConsistencyRecoveryBlocked(state, error);
            return true;
        }
        throw error;
    }
}

async function markRecoverySafetyBlocked(
    state: ScannerRuntimeState,
    error: ReorgRecoverySafetyError,
): Promise<void> {
    if (!(await isScannerLockHeld())) {
        console.error(
            '[Reorg] Cannot persist safety-blocked recovery state because scanner lock ownership was lost',
        );
        return;
    }
    if (!(await isScannerLockHeld()))
        throw new Error('Scanner lock ownership was lost before persisting safety-blocked recovery state');
    await markReorgRecoveryBlocked({
        scannerStateId: state.id,
        reason: `SAFETY:${error.message}`,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });
    await refreshScannerState(state);
    console.error(
        `[Reorg] CRITICAL: recovery blocked for safety; ${error.message}. Explicit operator intervention is required.`,
    );
}
