import { describe, expect, it } from 'vitest';
import { MAX_FILTER_ARRAY_VALUES } from '../src/constants/tx-filter.constants';
import {
    normalizeTxFilterValue,
    validateOperatorValue,
} from '../src/services/txFilterOperatorService';
import { getTxFilterField } from '../src/services/txFilterRegistry';
import {
    exactBigIntValue,
    mixedCaseTransferType,
    validDateValue,
    validSetValues,
} from './mock/txFilterOperatorService.mock';

describe('txFilterOperatorService', () => {
    it('normalizes case-insensitive string fields', () => {
        expect(
            normalizeTxFilterValue(mixedCaseTransferType, getTxFilterField('transferType')),
        ).toBe('native');
    });

    it('preserves exact bigint precision', () => {
        expect(normalizeTxFilterValue(exactBigIntValue, getTxFilterField('value'))).toBe(
            9007199254740993n,
        );
    });

    it('accepts only safe integers for numeric fields', () => {
        expect(normalizeTxFilterValue('42', getTxFilterField('blockNumber'))).toBe(42);
        expect(() =>
            normalizeTxFilterValue('9007199254740992', getTxFilterField('blockNumber')),
        ).toThrow('safe integers');
    });

    it('normalizes valid date values to timestamps', () => {
        expect(normalizeTxFilterValue(validDateValue, getTxFilterField('timestamp'))).toBe(
            Date.parse(validDateValue),
        );
    });

    it('validates non-empty set values within the configured array limit', () => {
        expect(() =>
            validateOperatorValue('in', validSetValues, getTxFilterField('transferType')),
        ).not.toThrow();
        expect(() =>
            validateOperatorValue(
                'in',
                Array.from({ length: MAX_FILTER_ARRAY_VALUES + 1 }, () => 'native'),
                getTxFilterField('transferType'),
            ),
        ).toThrow(`more than ${MAX_FILTER_ARRAY_VALUES} values`);
    });

    it('requires exactly two values for between', () => {
        expect(() =>
            validateOperatorValue('between', [1, 2], getTxFilterField('blockNumber')),
        ).not.toThrow();
        expect(() =>
            validateOperatorValue('between', [1], getTxFilterField('blockNumber')),
        ).toThrow('exactly two values');
    });

    it('rejects null and undefined filter values', () => {
        expect(() => normalizeTxFilterValue(null, getTxFilterField('transferType'))).toThrow(
            'cannot be null or undefined',
        );
        expect(() => normalizeTxFilterValue(undefined, getTxFilterField('transferType'))).toThrow(
            'cannot be null or undefined',
        );
    });
});
