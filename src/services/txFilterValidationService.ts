import { TxFilterGroupRule } from './txFilterEvaluatorService';
import { evaluateTxFilterOperator } from './txFilterOperatorService';

export function validateTxFilterGroup(group: TxFilterGroupRule): void {
    if (!group || !['AND', 'OR'].includes(group.logic)) {
        throw new Error('Every filter group must use AND or OR logic');
    }
    if (!Array.isArray(group.conditions) || !Array.isArray(group.groups)) {
        throw new Error('Every filter group must contain conditions and groups arrays');
    }
    if (group.conditions.length === 0 && group.groups.length === 0) {
        throw new Error('Every filter group must contain at least one condition or subgroup');
    }
    for (const condition of group.conditions) {
        if (
            !condition ||
            typeof condition.field !== 'string' ||
            typeof condition.operator !== 'string' ||
            condition.value === undefined
        ) {
            throw new Error('Every filter condition requires a field, operator, and value');
        }
        evaluateTxFilterOperator(condition.field, condition.operator, null, condition.value);
    }
    for (const child of group.groups) validateTxFilterGroup(child);
}
