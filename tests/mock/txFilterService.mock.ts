import type { TxFilterRecord, TxFilterRule } from '../../src/types/tx-filter.types';

export const validNativeRule: TxFilterRule = {
    field: 'transferType',
    op: 'eq',
    value: 'native',
};

export const activeNativeFilter: TxFilterRecord = {
    id: 1,
    description: 'Native ETH above threshold',
    isActive: true,
    rule: validNativeRule,
};

export const invalidActiveFilter: TxFilterRecord = {
    id: 2,
    description: 'Invalid filter fixture',
    isActive: true,
    rule: {
        field: 'unsupportedField',
        op: 'eq',
        value: 'invalid',
    },
};
