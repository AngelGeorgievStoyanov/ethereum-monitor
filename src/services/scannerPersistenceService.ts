import { TransferBatchItem, createTransfersBatch } from '../repositories/transactionRepository';
import {
    reconcileBlockTransferItems,
    persistProcessedBlockBatchTransaction,
    ProcessedBlockRecord,
    ReorgRecoveryProgress,
} from '../repositories/scannerPersistenceRepository';
import { mapTransactionCreationData } from '../mappers/transactionContextMapper';
import { isScannerLockHeld } from './scannerLockService';
import type { TransferBatchCandidate } from '../types/transfer-batch.types';

function mapTransferBatchItems(candidates: readonly TransferBatchCandidate[]): TransferBatchItem[] {
    return candidates.map((candidate) => ({
        data: mapTransactionCreationData(
            candidate.tx,
            candidate.receipt,
            candidate.blockTimestamp,
            candidate.transfer,
        ),
        matchingTxFilters: candidate.matchingTxFilters.map(({ id, description }) => ({ id, description })),
    }));
}

export async function createTransactionsFromEthereumDataBatch(
    candidates: readonly TransferBatchCandidate[],
    transaction?: import('sequelize').Transaction,
    reconcileMatches = false,
): Promise<void> {
    await createTransfersBatch(mapTransferBatchItems(candidates), transaction, reconcileMatches);
}

export async function reconcileBlockCandidates(
    candidates: readonly TransferBatchCandidate[],
    scannerStateId: string,
    expectedCheckpoint: number,
): Promise<void> {
    await reconcileBlockTransferItems(
        mapTransferBatchItems(candidates),
        scannerStateId,
        expectedCheckpoint,
        isScannerLockHeld,
    );
}

export interface PersistProcessedBlockBatchOptions {
    candidates: readonly TransferBatchCandidate[];
    blocks: readonly ProcessedBlockRecord[];
    scannerStateId: string;
    expectedCheckpoint: number;
    newCheckpoint: number;
    recoveryProgress?: ReorgRecoveryProgress;
}

export async function persistProcessedBlockBatch({
    candidates,
    blocks,
    scannerStateId,
    expectedCheckpoint,
    newCheckpoint,
    recoveryProgress,
}: PersistProcessedBlockBatchOptions): Promise<number> {
    return persistProcessedBlockBatchTransaction({
        transferItems: mapTransferBatchItems(candidates),
        blocks,
        scannerStateId,
        expectedCheckpoint,
        newCheckpoint,
        recoveryProgress,
        assertScannerLockHeld: isScannerLockHeld,
    });
}
