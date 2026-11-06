import type {
    StoredTransactionPage,
    TransactionPageResponse,
    TransactionResponseDto,
} from '../types/transaction.types';

function toIsoString(value: Date): string {
    return value.toISOString();
}

function mapTransactionResponse(
    transaction: StoredTransactionPage['items'][number],
): TransactionResponseDto {
    return {
        id: transaction.id,
        txHash: transaction.txHash,
        transferType: transaction.transferType,
        tokenAddress: transaction.tokenAddress,
        logIndex: transaction.logIndex,
        nonce: transaction.nonce,
        blockHash: transaction.blockHash,
        blockNumber: transaction.blockNumber,
        transactionIndex: transaction.transactionIndex,
        from: transaction.from,
        to: transaction.to,
        value: transaction.value,
        internalCount: transaction.internalCount,
        chainStatus: transaction.chainStatus,
        recordStatus: transaction.recordStatus,
        transactionType: transaction.transactionType,
        timestamp: transaction.timestamp ? toIsoString(transaction.timestamp) : null,
        createdAt: toIsoString(transaction.createdAt),
        updatedAt: toIsoString(transaction.updatedAt),
        matches: transaction.matches.map((match) => ({
            id: match.id,
            txId: match.txId,
            txFilterId: match.txFilterId,
            txFilterDescription: match.txFilterDescription,
            matchStatus: match.matchStatus,
            createdAt: toIsoString(match.createdAt),
            updatedAt: toIsoString(match.updatedAt),
            txFilter: match.txFilter
                ? {
                      id: match.txFilter.id,
                      description: match.txFilter.description,
                      isActive: match.txFilter.isActive,
                      rule: match.txFilter.rule,
                      createdAt: toIsoString(match.txFilter.createdAt),
                      updatedAt: toIsoString(match.txFilter.updatedAt),
                  }
                : null,
        })),
    };
}

export function mapTransactionPageResponse(page: StoredTransactionPage): TransactionPageResponse {
    return {
        items: page.items.map(mapTransactionResponse),
        pagination: page.pagination,
    };
}
