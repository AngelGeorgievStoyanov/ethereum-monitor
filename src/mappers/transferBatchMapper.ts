import { mapTransactionCreationData } from './transactionContextMapper';
import type { TransferBatchCandidate } from '../types/transfer-batch.types';
import type { TransferBatchItem } from '../types/transaction.types';

export function mapTransferBatchItems(
    candidates: readonly TransferBatchCandidate[],
): TransferBatchItem[] {
    return candidates.map((candidate) => ({
        data: mapTransactionCreationData(
            candidate.tx,
            candidate.receipt,
            candidate.blockTimestamp,
            candidate.transfer,
        ),
        matchingTxFilters: candidate.matchingTxFilters.map(({ id, description }) => ({
            id,
            description,
        })),
    }));
}
