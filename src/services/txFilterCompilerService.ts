import {
    MAX_FILTER_DEPTH,
    MAX_FILTER_NODES,
} from '../constants/tx-filter.constants';
import type {
    CompiledTxFilter,
    TxFilterConditionRule,
    TxFilterRule,
} from '../types/tx-filter.types';
import { getTxFilterField, getTxFilterOperator } from './txFilterRegistry';
import { validateTxFilterRule } from './txFilterValidationService';
import { normalizeTxFilterValue } from './txFilterOperatorService';

interface CompilationState {
    constants: unknown[];
    nodeCount: number;
}

function addConstant(state: CompilationState, value: unknown): string {
    const index = state.constants.push(value) - 1;
    return `constants[${index}]`;
}

function applyTemplate(template: string, replacements: Record<string, string>): string {
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
    const operator = getTxFilterOperator(condition.op);
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

function compileNode(rule: TxFilterRule, state: CompilationState, depth: number): string {
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
    if (keys.length === 1 && 'all' in rule) {
        return `(${rule.all.map((child) => compileNode(child, state, depth + 1)).join(' && ')})`;
    }
    if (keys.length === 1 && 'any' in rule) {
        return `(${rule.any.map((child) => compileNode(child, state, depth + 1)).join(' || ')})`;
    }
    if (keys.length === 1 && 'not' in rule) {
        return `(!${compileNode(rule.not, state, depth + 1)})`;
    }
    return compileCondition(rule as TxFilterConditionRule, state);
}

export function compileTxFilterRule(rule: TxFilterRule): CompiledTxFilter {
    validateTxFilterRule(rule);
    const state: CompilationState = { constants: [], nodeCount: 0 };
    const expression = compileNode(rule, state, 1);
    const factory = new Function(
        'constants',
        `return function compiledTransactionFilter(tx) { return ${expression}; }`,
    ) as (constants: unknown[]) => CompiledTxFilter;

    return factory(state.constants);
}
