import type { ActiveTxFilter, TransactionFilterContext } from '../types/tx-filter.types';

export function matchesTxFilter(
    transaction: TransactionFilterContext,
    txFilter: ActiveTxFilter,
): boolean {
    return txFilter.predicate(transaction);
}
