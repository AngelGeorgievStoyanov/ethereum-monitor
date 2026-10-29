import { evaluateTxFilterOperator } from './txFilterOperatorService';

export {
    ActiveTxFilter,
    TransactionFilterContext,
    TxFilterConditionRule,
    TxFilterGroupRule,
} from '../types/tx-filter.types';
import { TransactionFilterContext, TxFilterGroupRule } from '../types/tx-filter.types';

export function evaluateTxFilterGroup(
    group: TxFilterGroupRule,
    transaction: TransactionFilterContext,
): boolean {
    const results = [
        ...group.conditions.map((condition) =>
            evaluateTxFilterOperator({
                field: condition.field,
                operator: condition.operator,
                actualValue: transaction[condition.field],
                expectedValue: condition.value,
            }),
        ),
        ...group.groups.map((child) => evaluateTxFilterGroup(child, transaction)),
    ];

    if (results.length === 0) return false;
    return group.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}
