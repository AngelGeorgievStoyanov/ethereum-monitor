import type { TxFilterRule } from '../../src/types/tx-filter.types';

export const validBasicRule: TxFilterRule = {
    field: 'transferType',
    op: 'eq',
    value: 'native',
};

export const validNestedRule: TxFilterRule = {
    all: [
        { field: 'transferType', op: 'eq', value: 'native' },
        {
            any: [
                { field: 'value', op: 'gt', value: '1000000000000000000' },
                { not: { field: 'status', op: 'eq', value: 'failed' } },
            ],
        },
    ],
};

export const nullValueRule = {
    field: 'transferType',
    op: 'eq',
    value: null,
} as unknown as TxFilterRule;

export function createNestedNotRule(wrapperCount: number): TxFilterRule {
    let rule: TxFilterRule = validBasicRule;
    for (let index = 0; index < wrapperCount; index += 1) {
        rule = { not: rule };
    }
    return rule;
}

export function createNodeCountRule(childCount: number): TxFilterRule {
    return {
        all: Array.from({ length: childCount }, () => validBasicRule),
    };
}

export function createInRule(valueCount: number): TxFilterRule {
    return {
        field: 'txHash',
        op: 'in',
        value: Array.from({ length: valueCount }, (_, index) => `0x${index.toString(16)}`),
    };
}
