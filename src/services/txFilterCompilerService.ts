import type {
    CompiledTxFilter,
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

function applyTemplate(
    template: string,
    replacements: Record<string, string>,
): string {
    return Object.entries(replacements).reduce(
        (result, [placeholder, value]) => result.split(placeholder).join(value),
        template,
    );
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
        return applyTemplate(operator.template, { '$actual': actual, '$constant': constant });
    }
    if (operator.valueMode === 'range') {
        const values = condition.value as unknown[];
        const lower = addConstant(state, normalizeTxFilterValue(values[0], field));
        const upper = addConstant(state, normalizeTxFilterValue(values[1], field));
        return applyTemplate(operator.template, {
            '$actual': actual,
            '$lower': lower,
            '$upper': upper,
        });
    }

    const expected = addConstant(state, normalizeTxFilterValue(condition.value, field));
    return applyTemplate(operator.template, { '$actual': actual, '$expected': expected });
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

    const keys = Object.keys(rule);
    const groupKeys = keys.filter((key) => key === 'all' || key === 'any' || key === 'not');
    if (groupKeys.length > 0) {
        if (keys.length !== 1) throw new Error('A logical group must contain exactly one operator');
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
        if ('not' in rule) return `(!${compileNode(rule.not, state, depth + 1)})`;
        throw new Error('Unknown logical group');
    }

    if (keys.length !== 3 || !keys.includes('field') || !keys.includes('op') || !keys.includes('value')) {
        throw new Error('A condition must contain exactly field, op, and value');
    }
    return compileCondition(rule as TxFilterConditionRule, state);
}

export function compileTxFilterRule(rule: TxFilterRule): CompiledTxFilter {
    const state: CompilationState = { constants: [], nodeCount: 0 };
    const expression = compileNode(rule, state, 1);
    const factory = new Function(
        'constants',
        `return function compiledTransactionFilter(tx) { return ${expression}; }`,
    ) as (constants: unknown[]) => CompiledTxFilter;

    return factory(state.constants);
}
