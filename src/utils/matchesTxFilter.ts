import type { ActiveTxFilter, TransactionFilterContext } from '../types/tx-filter.types';

export function matchesTxFilter(
    transaction: TransactionFilterContext,
    txFilter: ActiveTxFilter,
    blockNumber: number,
): boolean {
    if (!txFilter.isActive) return false;
    if (txFilter.activeFromBlock !== null && blockNumber < txFilter.activeFromBlock) return false;
    return txFilter.predicate(transaction);
}
