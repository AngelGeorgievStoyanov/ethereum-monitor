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

export function validateTxFilterGroup(group: TxFilterGroupRule): void {
    if (!group || !['AND', 'OR'].includes(group.logic)) {
        throw new Error('Every filter group must use AND or OR logic');
    }
    if (!Array.isArray(group.conditions) || !Array.isArray(group.groups)) {
        throw new Error('Every filter group must contain conditions and groups arrays');
    }
    for (const condition of group.conditions) {
        evaluateTxFilterOperator(condition.field, condition.operator, null, condition.value);
    }
    for (const child of group.groups) validateTxFilterGroup(child);
}
