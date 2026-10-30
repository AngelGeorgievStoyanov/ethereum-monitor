import {
    ActiveTxFilter,
    TransactionFilterContext,
    evaluateTxFilterGroup,
} from '../services/txFilterEvaluatorService';

export function matchesTxFilter(
    transaction: TransactionFilterContext,
    txFilter: ActiveTxFilter,
    blockNumber: number,
): boolean {
    if (!txFilter.isActive) return false;
    if (txFilter.activeFromBlock !== null && blockNumber < txFilter.activeFromBlock) return false;
    return evaluateTxFilterGroup(txFilter.rule, transaction);
}
