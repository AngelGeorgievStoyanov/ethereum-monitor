import { getDynamicConfigService } from './dynamicConfigService';
import {
    MAX_REORG_LOOKBACK_BLOCKS,
    REORG_ANCESTOR_BATCH_SIZE,
    REORG_RECOVERY_STABLE_BLOCKS,
    SCANNER_ID,
} from '../constants/scanner.constants';
import type { ScannerRuntimeState } from '../types/scanner-state.types';
import { refreshScannerState, updateScannerRuntimeState } from './scannerStateService';
import {
    markReorgRecoveryBlocked,
    markReorgRecoveryPending as persistReorgRecoveryPending,
    rollbackToCommonAncestor,
} from '../repositories/reorgRecoveryRepository';
import { fetchBlockForProcessing, processFetchedBlock } from './blockProcessingService';
import { BlockVerificationUnavailableError } from '../errors/blockVerificationUnavailableError';
import { ConsensusUnavailableError } from './blockConsensusService';
import { getReorgVerifiedBlock } from './reorgBlockVerificationService';
import { BlockReceiptConsistencyError, evmRpcClient } from './evmBlockDataService';
import { persistProcessedBlockBatch } from './scannerPersistenceService';
import type { TxFilterConfigSnapshot } from '../types/tx-filter.types';
import {
    findCanonicalBlockIdentitiesInRange,
    type CanonicalBlockIdentity,
} from '../repositories/blockRepository';
import { iterateBlockRangeBatches } from '../utils/blockRangeBatch';
import {
    getConfirmedCheckpointBlock,
    hasCanonicalHistoryForCheckpoint,
    cacheConfirmedCheckpointBlock,
} from './scannerCheckpointCache';
import {
    findScannerStatusState,
    unblockScannerReorgRecovery,
} from '../repositories/scannerStateRepository';
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

    updateScannerRuntimeState({
        reorgRecoveryBlocked: false,
        reorgRecoveryBlockReason: null,
    });
    return { kind: 'unblocked', response: mapReorgRecoveryRetryResponse(state) };
}

class ReorgRecoverySafetyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReorgRecoverySafetyError';
    }
}

let singleProviderReorgWarningLogged = false;
let lastLoggedRecoveryFilterConfigVersion = '';
let lastVerifiedFinalizedHead = '';

function logSingleProviderReorgMode(): void {
    if (evmRpcClient.getEndpointCount() !== 1 || singleProviderReorgWarningLogged) return;
    console.warn(
        '[Reorg] WARNING: Only one RPC provider is configured. Independent consensus is unavailable; provider P1 is the source of truth for reorg detection and recovery. Consensus verification is disabled.',
    );
    singleProviderReorgWarningLogged = true;
}

function sameBlock(
    stored: { blockHash: string; parentHash: string },
    current: { blockHash: string; parentHash: string },
): boolean {
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
    await persistReorgRecoveryPending(scannerStateId, checkpoint, targetBlock);
    lastVerifiedFinalizedHead = '';
    updateScannerRuntimeState({
        reorgRecoveryActive: true,
        reorgRecoveryBlocked: false,
        reorgRecoveryBlockReason: null,
        reorgRecoveryStableBlocks: 0,
        reorgRecoveryStartBlock: checkpoint,
        reorgRecoveryTargetBlock: targetBlock,
    });
}

async function findAncestorAndRollback(state: ScannerRuntimeState): Promise<void> {
    const originalCheckpoint = state.reorgRecoveryStartBlock;
    if (originalCheckpoint === null)
        throw new Error('Reorg recovery has no checkpoint to reconcile');

    console.warn(`[Reorg] Searching for a common ancestor at or below block ${originalCheckpoint}`);
    let ancestor: CanonicalBlockIdentity | null = null;
    let ancestorDepth = 0;
    const lowestBlock = Math.max(0, originalCheckpoint - MAX_REORG_LOOKBACK_BLOCKS);

    if (originalCheckpoint > 0) {
        for (const range of iterateBlockRangeBatches({
        fromBlock: lowestBlock,
        toBlock: originalCheckpoint - 1,
        batchSize: REORG_ANCESTOR_BATCH_SIZE,
        direction: 'backward',
    })) {
        const storedBlocks = await findCanonicalBlockIdentitiesInRange(
            range.fromBlock,
            range.toBlock,
        );
        const storedBlocksByNumber = new Map(
            storedBlocks.map((block) => [block.blockNumber, block]),
        );

        for (let blockNumber = range.toBlock; blockNumber >= range.fromBlock; blockNumber -= 1) {
            const storedBlock = storedBlocksByNumber.get(blockNumber);
            if (!storedBlock) {
                throw new ReorgRecoverySafetyError(
                    `Cannot safely recover reorg at block ${originalCheckpoint}: block history is missing at ${blockNumber}`,
                );
            }

            const currentBlock = await getReorgVerifiedBlock(
                blockNumber,
                'common ancestor search',
            );
            if (sameBlock(storedBlock, currentBlock)) {
                ancestor = storedBlock;
                ancestorDepth = originalCheckpoint - blockNumber;
                break;
            }
        }

        if (ancestor) break;
        }
    }

    if (!ancestor) {
        throw new ReorgRecoverySafetyError(
            `No common ancestor found within ${MAX_REORG_LOOKBACK_BLOCKS} blocks at or below ${originalCheckpoint}`,
        );
    }

    const rollback = await rollbackToCommonAncestor({
        scannerStateId: state.id,
        expectedCheckpoint: originalCheckpoint,
        ancestorBlockNumber: ancestor.blockNumber,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });

    lastVerifiedFinalizedHead = '';
    Object.assign(state, {
        lastProcessedBlock: rollback.checkpoint,
        reorgRecoveryActive: true,
        reorgRecoveryStableBlocks: 0,
        reorgRecoveryStartBlock: null,
        reorgRecoveryTargetBlock:
            state.reorgRecoveryTargetBlock ?? originalCheckpoint + REORG_RECOVERY_STABLE_BLOCKS,
    });
    updateScannerRuntimeState(state);
    cacheConfirmedCheckpointBlock(ancestor, rollback.checkpoint);
    recordReorgAncestorFound(ancestorDepth);
    console.warn(
        `[Reorg] Common ancestor=${ancestor.blockNumber}; marked ${rollback.orphanedBlockCount} block(s) as reorged; checkpoint rolled back to ${rollback.checkpoint}`,
    );
}

async function processReorgRecoveryInternal(
    state: ScannerRuntimeState,
    finalizedBlockNumber: number,
    finalizedBlockHash: string,
    getActiveTxFilters: () => TxFilterConfigSnapshot,
): Promise<boolean> {
    if (state.reorgRecoveryBlocked) return true;
    if (state.reorgRecoveryActive) logSingleProviderReorgMode();
    if (state.lastProcessedBlock < 0 && !state.reorgRecoveryActive) return false;

    if (state.reorgRecoveryActive && state.reorgRecoveryStartBlock !== null) {
        await findAncestorAndRollback(state);
    } else if (!state.reorgRecoveryActive) {
        const finalizedHeadKey = finalizedBlockHash.toLowerCase() || String(finalizedBlockNumber);
        if (lastVerifiedFinalizedHead === finalizedHeadKey) return false;

        const storedCheckpoint = await getConfirmedCheckpointBlock(state.lastProcessedBlock);
        if (!storedCheckpoint) {
            if (!(await hasCanonicalHistoryForCheckpoint(state.lastProcessedBlock))) {
                lastVerifiedFinalizedHead = finalizedHeadKey;
                return false; // Fresh scanner baseline: no canonical block history exists yet.
            }
            throw new ReorgRecoverySafetyError(
                `Canonical block history is missing at checkpoint ${state.lastProcessedBlock}`,
            );
        }

        // Verify once per distinct finalized head. Newly processed checkpoints are already
        // checked through their fetched block data and parent-hash continuity.
        // If it disagrees, the verification service selects single-provider verification or strict consensus.
        const currentCheckpoint = await evmRpcClient.getBlock(state.lastProcessedBlock);
        if (!currentCheckpoint)
            throw new Error(`Unable to read checkpoint block ${state.lastProcessedBlock}`);
        const primaryMatches = sameBlock(storedCheckpoint, {
            blockHash: currentCheckpoint.hash ?? '',
            parentHash: currentCheckpoint.parentHash,
        });
        if (primaryMatches) {
            lastVerifiedFinalizedHead = finalizedHeadKey;
            return false;
        }

        const verifiedCheckpoint = await getReorgVerifiedBlock(
            state.lastProcessedBlock,
            'reorg detection',
        );
        if (sameBlock(storedCheckpoint, verifiedCheckpoint)) {
            console.warn(
                evmRpcClient.getEndpointCount() === 1
                    ? `[Reorg] Provider P1's follow-up read matches stored history at checkpoint ${state.lastProcessedBlock}; continuing normal scan`
                    : `[Reorg] Primary provider disagreed at checkpoint ${state.lastProcessedBlock}, but configured providers agree with stored history; continuing normal scan`,
            );
            lastVerifiedFinalizedHead = finalizedHeadKey;
            return false;
        }

        logSingleProviderReorgMode();
        console.error(
            `[Reorg] Detected chain mismatch at block ${state.lastProcessedBlock}; storedHash=${storedCheckpoint.blockHash}; currentHash=${currentCheckpoint.hash}`,
        );
        recordReorgDetected();
        await markReorgRecoveryPending(state.id, state.lastProcessedBlock);
        await findAncestorAndRollback(state);
    }

    if (!state.reorgRecoveryActive) return true;
    if (getActiveTxFilters().filters.length === 0) {
        console.warn('[Reorg] Recovery is paused because there are no active transaction filters');
        return true;
    }

    while (state.reorgRecoveryActive && state.lastProcessedBlock < finalizedBlockNumber) {
        if (getDynamicConfigService().getScannerControlSnapshot()) return true;

        const blockNumber = state.lastProcessedBlock + 1;
        const verifiedBlock = await getReorgVerifiedBlock(blockNumber, 'reorg recovery');
        const previousCanonicalBlock = await getConfirmedCheckpointBlock(state.lastProcessedBlock);
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
        const filterConfig = getActiveTxFilters();
        if (filterConfig.filters.length === 0) {
            console.warn(
                '[Reorg] Recovery is paused because there are no active transaction filters',
            );
            return true;
        }
        if (filterConfig.version !== lastLoggedRecoveryFilterConfigVersion) {
            console.log(
                `[Reorg] First recovery block using transaction filter config version=${filterConfig.version}; block=${blockNumber}; filters=${filterConfig.filters.length}`,
            );
            lastLoggedRecoveryFilterConfigVersion = filterConfig.version;
        }
        const prepared = await processFetchedBlock(fetched, filterConfig.filters, true);

        const recoveryTargetBlock =
            state.reorgRecoveryTargetBlock ??
            state.lastProcessedBlock + REORG_RECOVERY_STABLE_BLOCKS;
        const stableBlocks =
            blockNumber > recoveryTargetBlock - REORG_RECOVERY_STABLE_BLOCKS
                ? state.reorgRecoveryStableBlocks + 1
                : 0;
        const recoveryComplete = blockNumber >= recoveryTargetBlock;
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
        cacheConfirmedCheckpointBlock(prepared.block, blockNumber);
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

interface LocalBlockedRecoveryUpdate {
    reason: string;
    initializeRecovery?: boolean;
    preserveStartBlock?: boolean;
    stableBlocks: number;
}

function updateLocalBlockedState(
    state: ScannerRuntimeState,
    input: LocalBlockedRecoveryUpdate,
): void {
    const updates: Partial<ScannerRuntimeState> = {};

    if (input.initializeRecovery) {
        if (!state.reorgRecoveryActive) {
            updates.reorgRecoveryActive = true;
            updates.reorgRecoveryStartBlock = state.lastProcessedBlock;
            updates.reorgRecoveryTargetBlock = state.lastProcessedBlock + input.stableBlocks;
            updates.reorgRecoveryStableBlocks = 0;
        }
    } else {
        updates.reorgRecoveryActive = true;
        if (!input.preserveStartBlock && state.reorgRecoveryStartBlock === null) {
            updates.reorgRecoveryStartBlock = state.lastProcessedBlock;
        }
        if (state.reorgRecoveryTargetBlock === null) {
            updates.reorgRecoveryTargetBlock = state.lastProcessedBlock + input.stableBlocks;
        }
    }

    updates.reorgRecoveryBlocked = true;
    updates.reorgRecoveryBlockReason = input.reason.slice(0, 500);
    Object.assign(state, updates);
    updateScannerRuntimeState(updates);
}

async function markVerificationRecoveryBlocked(
    state: ScannerRuntimeState,
    error: BlockVerificationUnavailableError,
): Promise<void> {
    if (error instanceof ConsensusUnavailableError) recordReorgConsensusFailure();
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
    updateLocalBlockedState(state, {
        reason: `${reasonPrefix}:${error.operation}:block=${error.blockNumber}`,
        initializeRecovery: true,
        preserveStartBlock: true,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });
    console.error(
        `[Reorg] CRITICAL: recovery is blocked because block verification failed; block=${error.blockNumber}; operation=${error.operation}; reason=${error.message}. Explicit operator retry is required.`,
    );
}

async function markReceiptConsistencyRecoveryBlocked(
    state: ScannerRuntimeState,
    error: BlockReceiptConsistencyError,
): Promise<void> {

    await markReorgRecoveryBlocked({
        scannerStateId: state.id,
        reason: `RECEIPT_CONSISTENCY:block=${error.blockNumber}:${error.message}`,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });

    updateLocalBlockedState(state, {
        reason: `RECEIPT_CONSISTENCY:block=${error.blockNumber}:${error.message}`,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });
    console.error(
        `[Reorg] CRITICAL: recovery blocked after receipt inconsistency at block ${error.blockNumber}. Automatic retries stopped; check RPC provider consistency before explicitly retrying recovery.`,
    );
}

export async function processReorgRecovery(
    state: ScannerRuntimeState,
    finalizedBlockNumber: number,
    finalizedBlockHash: string,
    getActiveTxFilters: () => TxFilterConfigSnapshot,
): Promise<boolean> {
    try {
        return await processReorgRecoveryInternal(
            state,
            finalizedBlockNumber,
            finalizedBlockHash,
            getActiveTxFilters,
        );
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
    await markReorgRecoveryBlocked({
        scannerStateId: state.id,
        reason: `SAFETY:${error.message}`,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });
    updateLocalBlockedState(state, {
        reason: `SAFETY:${error.message}`,
        stableBlocks: REORG_RECOVERY_STABLE_BLOCKS,
    });
    console.error(
        `[Reorg] CRITICAL: recovery blocked for safety; ${error.message}. Explicit operator intervention is required.`,
    );
}
