import type {
    CompiledTxFilter,
    TransactionFilterContext,
    TxFilterConditionRule,
    TxFilterRule,
} from '../types/tx-filter.types';
import { getTxFilterField } from './txFilterFieldRegistry';
import {
    normalizeTxFilterValue,
    TX_FILTER_OPERATORS,
    validateOperatorValue,
} from './txFilterOperatorService';

const MAX_FILTER_DEPTH = 20;
const MAX_FILTER_NODES = 2000;

interface CompilationState {
    constants: unknown[];
    nodeCount: number;
}

function addConstant(state: CompilationState, value: unknown): string {
    const index = state.constants.push(value) - 1;
    return `constants[${index}]`;
}

function compileCondition(
    condition: TxFilterConditionRule,
    state: CompilationState,
): string {
    const field = getTxFilterField(condition.field);
    const operator = TX_FILTER_OPERATORS[condition.op];
    if (!operator) throw new Error(`Unsupported transaction filter operator "${condition.op}"`);
    validateOperatorValue(condition.op, condition.value, field);

    const actual = field.accessor;
    if (operator.valueMode === 'set') {
        const values = (condition.value as unknown[]).map((value) =>
            normalizeTxFilterValue(value, field),
        );
        const constant = addConstant(state, new Set(values));
        return operator.template.replace('$actual', actual).replace('$constant', constant);
    }
    if (operator.valueMode === 'range') {
        const values = condition.value as unknown[];
        const lower = addConstant(state, normalizeTxFilterValue(values[0], field));
        const upper = addConstant(state, normalizeTxFilterValue(values[1], field));
        return operator.template
            .replace('$actual', actual)
            .replace('$lower', lower)
            .replace('$upper', upper);
    }

    const expectedValue = normalizeTxFilterValue(condition.value, field);
    const expected = addConstant(state, expectedValue);
    return operator.template.replace('$actual', actual).replace('$expected', expected);
}

function compileNode(
    rule: TxFilterRule,
    state: CompilationState,
    depth: number,
): string {
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

    if ('all' in rule) {
        if (!Array.isArray(rule.all) || rule.all.length === 0) {
            throw new Error('"all" requires a non-empty array');
        }
        return `(${rule.all.map((child) => compileNode(child, state, depth + 1)).join(' && ')})`;
    }
    if ('any' in rule) {
        if (!Array.isArray(rule.any) || rule.any.length === 0) {
            throw new Error('"any" requires a non-empty array');
        }
        return `(${rule.any.map((child) => compileNode(child, state, depth + 1)).join(' || ')})`;
    }
    if ('not' in rule) {
        return `(!${compileNode(rule.not, state, depth + 1)})`;
    }

    const condition = rule as TxFilterConditionRule;
    if (
        typeof condition.field !== 'string' ||
        typeof condition.op !== 'string' ||
        !Object.prototype.hasOwnProperty.call(condition, 'value')
    ) {
        throw new Error('A condition requires field, op, and value');
    }
    return compileCondition(condition, state);
}

export function compileTxFilterRule(rule: TxFilterRule): CompiledTxFilter {
    const state: CompilationState = { constants: [], nodeCount: 0 };
    const expression = compileNode(rule, state, 1);
    const factory = new Function(
        'constants',
        `return function compiledTransactionFilter(tx) { return ${expression}; }`,
    ) as (constants: unknown[]) => CompiledTxFilter;

    const predicate = factory(state.constants);
    return (transaction: TransactionFilterContext): boolean => predicate(transaction);
}
