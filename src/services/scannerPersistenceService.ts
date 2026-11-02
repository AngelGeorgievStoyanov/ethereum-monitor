import { BaseError } from 'sequelize';
import { createTransfersBatch } from '../repositories/transactionRepository';
import { mapTransferBatchItems } from '../mappers/transferBatchMapper';
import {
    reconcileBlockTransferItems,
    persistProcessedBlockBatchTransaction,
    ProcessedBlockRecord,
    ReorgRecoveryProgress,
} from '../repositories/scannerPersistenceRepository';
import { recordDatabaseFailure } from './metricsAggregatorService';
import { formatError } from '../utils/formatError';
import type { TransferBatchCandidate } from '../types/transfer-batch.types';

async function trackDatabaseFailure<T>(operation: string, action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof BaseError) {
            recordDatabaseFailure(operation, formatError(error));
        }
        throw error;
    }
}

export async function createTransactionsFromEthereumDataBatch(
    candidates: readonly TransferBatchCandidate[],
    transaction?: import('sequelize').Transaction,
    reconcileMatches = false,
): Promise<void> {
    await trackDatabaseFailure('createTransactionsFromEthereumDataBatch', () =>
        createTransfersBatch(mapTransferBatchItems(candidates), transaction, reconcileMatches),
    );
}

export async function reconcileBlockCandidates(
    candidates: readonly TransferBatchCandidate[],
    scannerStateId: string,
    expectedCheckpoint: number,
): Promise<void> {
    await trackDatabaseFailure('reconcileBlockCandidates', () =>
        reconcileBlockTransferItems(
            mapTransferBatchItems(candidates),
            scannerStateId,
            expectedCheckpoint,
        ),
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
    return trackDatabaseFailure('persistProcessedBlockBatch', () =>
        persistProcessedBlockBatchTransaction({
            transferItems: mapTransferBatchItems(candidates),
            blocks,
            scannerStateId,
            expectedCheckpoint,
            newCheckpoint,
            recoveryProgress,
        }),
    );
}
