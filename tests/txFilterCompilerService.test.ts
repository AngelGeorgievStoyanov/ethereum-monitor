import { describe, expect, it } from 'vitest';
import type { TransactionFilterContext } from '../src/types/tx-filter.types';
import { compileTxFilterRule } from '../src/services/txFilterCompilerService';
import {
    failedTransaction,
    nativeTransferRule,
    nestedRule,
    transaction,
} from './mock/txFilterCompilerService.mock';

describe('txFilterCompilerService', () => {
    it('compiles and executes a case-insensitive equality condition', () => {
        const predicate = compileTxFilterRule(nativeTransferRule);

        expect(predicate(transaction)).toBe(true);
        expect(predicate(failedTransaction)).toBe(false);
    });

    it('evaluates nested all, any and not groups', () => {
        const predicate = compileTxFilterRule(nestedRule);
        const lowValueSuccessfulTransaction: TransactionFilterContext = {
            ...transaction,
            value: 50n,
        };
        const lowValueFailedTransaction: TransactionFilterContext = {
            ...transaction,
            value: 50n,
            status: 'failed',
        };

        expect(predicate(transaction)).toBe(true);
        expect(predicate(lowValueSuccessfulTransaction)).toBe(true);
        expect(predicate(lowValueFailedTransaction)).toBe(false);
        expect(predicate(failedTransaction)).toBe(false);
    });

    it('compares bigint values without converting them to floating-point numbers', () => {
        const predicate = compileTxFilterRule({
            field: 'value',
            op: 'gt',
            value: '9007199254740993',
        });

        expect(predicate({ value: 9007199254740994n })).toBe(true);
        expect(predicate({ value: 9007199254740993n })).toBe(false);
    });

    it('supports set membership operators', () => {
        const predicate = compileTxFilterRule({
            field: 'transferType',
            op: 'in',
            value: ['NATIVE', 'ERC20'],
        });

        expect(predicate(transaction)).toBe(true);
        expect(predicate({ transferType: 'erc20' })).toBe(true);
        expect(predicate({ transferType: 'internal' })).toBe(false);
    });

    it('supports inclusive between comparisons', () => {
        const predicate = compileTxFilterRule({
            field: 'blockNumber',
            op: 'between',
            value: [100, 200],
        });

        expect(predicate({ blockNumber: 100 })).toBe(true);
        expect(predicate({ blockNumber: 150 })).toBe(true);
        expect(predicate({ blockNumber: 200 })).toBe(true);
        expect(predicate({ blockNumber: 201 })).toBe(false);
    });

    it('does not match missing values for comparison operators', () => {
        const predicate = compileTxFilterRule({
            field: 'blockNumber',
            op: 'gt',
            value: 10,
        });

        expect(predicate({})).toBe(false);
        expect(predicate({ blockNumber: null })).toBe(false);
    });

    it('rejects invalid rules before compilation', () => {
        expect(() =>
            compileTxFilterRule({
                field: 'value',
                op: 'gt',
                value: null,
            }),
        ).toThrow('Filter values cannot be null or undefined');
    });
});
