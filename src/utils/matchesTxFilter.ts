import type { ActiveTxFilter, TransactionFilterContext } from '../types/tx-filter.types';
import { formatError } from './formatError';
import { publishFilterMetricEvent } from '../metrics/filterMetricsEventBus';

export function matchesTxFilter(
    transaction: TransactionFilterContext,
    txFilter: ActiveTxFilter,
): boolean {
    const startedAt = Date.now();
    let matched = false;
    let failed = false;
    try {
        matched = txFilter.predicate(transaction);
        return matched;
    } catch (error) {
        failed = true;
        console.error(
            `[TxFilter] Predicate failed; filterId=${txFilter.id}; skipping this filter for the current transfer: ${formatError(error)}`,
        );
        return false;
    } finally {
        publishFilterMetricEvent({
            filterId: txFilter.id,
            durationMs: Date.now() - startedAt,
            matched,
            failed,
        });
    }
}
