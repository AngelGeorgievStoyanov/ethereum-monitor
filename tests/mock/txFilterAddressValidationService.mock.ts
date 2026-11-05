import type { TxFilterRule } from '../../src/types/tx-filter.types';

export const validAddress = '0x000000000000000000000000000000000000dead';

export const validAddressRule: TxFilterRule = {
    field: 'from',
    op: 'eq',
    value: validAddress,
};

export const invalidAddressRule: TxFilterRule = {
    field: 'to',
    op: 'eq',
    value: 'not-an-ethereum-address',
};

export function createAddressSetRule(addressCount: number): TxFilterRule {
    return {
        field: 'from',
        op: 'in',
        value: Array.from(
            { length: addressCount },
            (_, index) => `0x${index.toString(16).padStart(40, '0')}`,
        ),
    };
}
