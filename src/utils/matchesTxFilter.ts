import type { ActiveTxFilter, TransactionFilterContext } from '../types/tx-filter.types';
import { formatError } from './formatError';

export function matchesTxFilter(
    transaction: TransactionFilterContext,
    txFilter: ActiveTxFilter,
): boolean {
    try {
        return txFilter.predicate(transaction);
    } catch (error) {
        console.error(
            `[TxFilter] Predicate failed; filterId=${txFilter.id}; skipping this filter for the current transfer: ${formatError(error)}`,
        );
        return false;
    }
}
