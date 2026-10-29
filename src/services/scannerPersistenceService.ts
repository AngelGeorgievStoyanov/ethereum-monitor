import { createTransfersBatch } from '../repositories/transactionRepository';
import { mapTransferBatchItems } from '../mappers/transferBatchMapper';
import {
    reconcileBlockTransferItems,
    persistProcessedBlockBatchTransaction,
    ProcessedBlockRecord,
    ReorgRecoveryProgress,
} from '../repositories/scannerPersistenceRepository';
import { isScannerLockHeld } from './scannerLockService';
import type { TransferBatchCandidate } from '../types/transfer-batch.types';


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
