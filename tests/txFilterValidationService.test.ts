import { describe, expect, it } from 'vitest';
import {
    MAX_FILTER_ARRAY_VALUES,
    MAX_FILTER_DEPTH,
    MAX_FILTER_NODES,
} from '../src/constants/tx-filter.constants';
import { validateTxFilterRule } from '../src/services/txFilterValidationService';
import { ValidationError } from '../src/utils/validationError';
import {
    createInRule,
    createNestedNotRule,
    createNodeCountRule,
    nullValueRule,
    validBasicRule,
    validNestedRule,
} from './mock/txFilterValidationService.mock';

describe('txFilterValidationService', () => {
    it('accepts a valid condition', () => {
        expect(() => validateTxFilterRule(validBasicRule)).not.toThrow();
    });

    it('accepts nested all, any and not groups', () => {
        expect(() => validateTxFilterRule(validNestedRule)).not.toThrow();
    });

    it('rejects null condition values', () => {
        expect(() => validateTxFilterRule(nullValueRule)).toThrow(ValidationError);
        expect(() => validateTxFilterRule(nullValueRule)).toThrow(
            'Filter values cannot be null or undefined',
        );
    });

    it('enforces the maximum nesting depth boundary', () => {
        expect(() => validateTxFilterRule(createNestedNotRule(MAX_FILTER_DEPTH - 1))).not.toThrow();
        expect(() => validateTxFilterRule(createNestedNotRule(MAX_FILTER_DEPTH))).toThrow(
            `maximum nesting depth of ${MAX_FILTER_DEPTH}`,
        );
    });

    it('enforces the maximum node count boundary', () => {
        expect(() => validateTxFilterRule(createNodeCountRule(MAX_FILTER_NODES - 1))).not.toThrow();
        expect(() => validateTxFilterRule(createNodeCountRule(MAX_FILTER_NODES))).toThrow(
            `maximum of ${MAX_FILTER_NODES} nodes`,
        );
    });

    it('accepts the maximum number of values in an array operator', () => {
        expect(() => validateTxFilterRule(createInRule(MAX_FILTER_ARRAY_VALUES))).not.toThrow();
    });

    it('rejects arrays above the configured value limit', () => {
        expect(() => validateTxFilterRule(createInRule(MAX_FILTER_ARRAY_VALUES + 1))).toThrow(
            `more than ${MAX_FILTER_ARRAY_VALUES} values`,
        );
    });

    it('rejects empty logical groups', () => {
        expect(() => validateTxFilterRule({ all: [] })).toThrow('requires a non-empty array');
        expect(() => validateTxFilterRule({ any: [] })).toThrow('requires a non-empty array');
    });

    it('rejects unsupported fields and operators', () => {
        expect(() => validateTxFilterRule({ field: 'chainId', op: 'eq', value: '1' })).toThrow(
            'Unsupported transaction filter field',
        );
        expect(() =>
            validateTxFilterRule({ field: 'transferType', op: 'gt', value: 'native' }),
        ).toThrow('not supported for this field');
    });
});
