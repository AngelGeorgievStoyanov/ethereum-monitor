import { MAX_FILTER_DEPTH, MAX_FILTER_NODES } from '../constants/tx-filter.constants';
import type { TxFilterRule } from '../types/tx-filter.types';
import { getTxFilterField } from './txFilterRegistry';
import { validateOperatorValue } from './txFilterOperatorService';
import { ValidationError } from '../utils/validationError';

interface ValidationState {
    nodeCount: number;
}

function validateNode(rule: unknown, state: ValidationState, depth: number): void {
    state.nodeCount += 1;
    if (state.nodeCount > MAX_FILTER_NODES) {
        throw new Error(`Filter exceeds the maximum of ${MAX_FILTER_NODES} nodes`);
    }
    if (depth > MAX_FILTER_DEPTH) {
        throw new Error(`Filter exceeds the maximum nesting depth of ${MAX_FILTER_DEPTH}`);
    }
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new Error('Every filter rule must be an object');
    }

    const node = rule as Record<string, unknown>;
    const keys = Object.keys(node);
    const groupKeys = keys.filter((key) => key === 'all' || key === 'any' || key === 'not');

    if (groupKeys.length > 0) {
        if (keys.length !== 1) throw new Error('A logical group must contain exactly one operator');
        const group = groupKeys[0];
        if (group === 'not') {
            validateNode(node.not, state, depth + 1);
            return;
        }
        const children = node[group];
        if (!Array.isArray(children) || children.length === 0) {
            throw new Error(`"${group}" requires a non-empty array`);
        }
        for (const child of children) validateNode(child, state, depth + 1);
        return;
    }

    if (
        keys.length !== 3 ||
        !keys.includes('field') ||
        !keys.includes('op') ||
        !keys.includes('value')
    ) {
        throw new Error('A condition must contain exactly field, op, and value');
    }
    if (typeof node.field !== 'string' || node.field.length === 0) {
        throw new Error('Condition field must be a non-empty string');
    }
    if (typeof node.op !== 'string' || node.op.length === 0) {
        throw new Error('Condition op must be a non-empty string');
    }

    const field = getTxFilterField(node.field);
    validateOperatorValue(node.op, node.value, field);
}

export function validateTxFilterRule(rule: TxFilterRule): void {
    try {
        validateNode(rule, { nodeCount: 0 }, 1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ValidationError(message);
    }
}
