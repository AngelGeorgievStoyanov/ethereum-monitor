import { evaluateTxFilterOperator } from './txFilterOperatorService';

export interface TxFilterConditionRule {
    field: string;
    operator: string;
    value: unknown;
}

export interface TxFilterGroupRule {
    logic: 'AND' | 'OR';
    conditions: TxFilterConditionRule[];
    groups: TxFilterGroupRule[];
}

export interface ActiveTxFilter {
    id: number;
    description: string;
    isActive: boolean;
    activeFromBlock: number | null;
    rule: TxFilterGroupRule;
}

export interface TransactionFilterContext {
    [field: string]: unknown;
}

export function evaluateTxFilterGroup(
    group: TxFilterGroupRule,
    transaction: TransactionFilterContext,
): boolean {
    const results = [
        ...group.conditions.map((condition) =>
            evaluateTxFilterOperator(
                condition.field,
                condition.operator,
                transaction[condition.field],
                condition.value,
            ),
        ),
        ...group.groups.map((child) => evaluateTxFilterGroup(child, transaction)),
    ];

    if (results.length === 0) return false;
    return group.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}
