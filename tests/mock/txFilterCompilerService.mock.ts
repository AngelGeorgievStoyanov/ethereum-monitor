import type { TransactionFilterContext, TxFilterRule } from '../../src/types/tx-filter.types';

export const nativeTransferRule: TxFilterRule = {
    field: 'transferType',
    op: 'eq',
    value: 'NATIVE',
};

export const nestedRule: TxFilterRule = {
    all: [
        { field: 'transferType', op: 'eq', value: 'native' },
        {
            any: [
                { field: 'value', op: 'gte', value: '100' },
                { not: { field: 'status', op: 'eq', value: 'failed' } },
            ],
        },
    ],
};

export const transaction: TransactionFilterContext = {
    tx: {
        transferType: 'native',
        value: 150n,
        status: 'success',
        from: '0x000000000000000000000000000000000000dead',
    },
};

export const failedTransaction: TransactionFilterContext = {
    tx: {
        transferType: 'erc20',
        value: 50n,
        status: 'failed',
        from: '0x000000000000000000000000000000000000beef',
    },
};
