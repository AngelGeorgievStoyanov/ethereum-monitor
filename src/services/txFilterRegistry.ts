export type TxFilterFieldType = 'string' | 'number' | 'bigint' | 'date';
export type TxFilterOperatorName =
    'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between';

export type TxFilterAddressKind = 'address' | 'tokenContract';

export interface TxFilterOperatorDefinition {
    template: string;
    valueMode?: 'single' | 'set' | 'range';
}

export interface TxFilterFieldDefinition {
    type: TxFilterFieldType;
    accessor: string;
    operators: readonly TxFilterOperatorName[];
    normalize?: 'lowercase';
    addressKind?: TxFilterAddressKind;
}

const EQUALITY_OPERATORS = ['eq', 'ne', 'in', 'notIn'] as const;
const COMPARISON_OPERATORS = [...EQUALITY_OPERATORS, 'gt', 'gte', 'lt', 'lte', 'between'] as const;

const comparable =
    '$actual !== null && $actual !== undefined && $expected !== null && $expected !== undefined';

export const TX_FILTER_OPERATORS: Record<TxFilterOperatorName, TxFilterOperatorDefinition> = {
    eq: { template: '($actual === $expected)' },
    ne: { template: '($actual !== null && $actual !== undefined && $actual !== $expected)' },
    gt: { template: `(${comparable} && $actual > $expected)` },
    gte: { template: `(${comparable} && $actual >= $expected)` },
    lt: { template: `(${comparable} && $actual < $expected)` },
    lte: { template: `(${comparable} && $actual <= $expected)` },
    in: { template: '($constant.has($actual))', valueMode: 'set' },
    notIn: {
        template: '($actual !== null && $actual !== undefined && !$constant.has($actual))',
        valueMode: 'set',
    },
    between: {
        template:
            '($actual !== null && $actual !== undefined && $lower !== null && $upper !== null && $actual >= $lower && $actual <= $upper)',
        valueMode: 'range',
    },
};

export const TX_FILTER_FIELDS: Record<string, TxFilterFieldDefinition> = {
    txHash: {
        type: 'string',
        accessor: 'tx.txHash',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
    },
    transferType: {
        type: 'string',
        accessor: 'tx.transferType',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
    },
    tokenAddress: {
        type: 'string',
        accessor: 'tx.tokenAddress',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
        addressKind: 'tokenContract',
    },
    logIndex: { type: 'number', accessor: 'tx.logIndex', operators: COMPARISON_OPERATORS },
    nonce: { type: 'number', accessor: 'tx.nonce', operators: COMPARISON_OPERATORS },
    blockHash: {
        type: 'string',
        accessor: 'tx.blockHash',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
    },
    blockNumber: {
        type: 'number',
        accessor: 'tx.blockNumber',
        operators: COMPARISON_OPERATORS,
    },
    transactionIndex: {
        type: 'number',
        accessor: 'tx.transactionIndex',
        operators: COMPARISON_OPERATORS,
    },
    from: {
        type: 'string',
        accessor: 'tx.from',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
        addressKind: 'address',
    },
    to: {
        type: 'string',
        accessor: 'tx.to',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
        addressKind: 'address',
    },
    value: { type: 'bigint', accessor: 'tx.value', operators: COMPARISON_OPERATORS },
    internalCount: {
        type: 'number',
        accessor: 'tx.internalCount',
        operators: COMPARISON_OPERATORS,
    },
    status: {
        type: 'string',
        accessor: 'tx.status',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
    },
    transactionType: {
        type: 'string',
        accessor: 'tx.transactionType',
        normalize: 'lowercase',
        operators: EQUALITY_OPERATORS,
    },
    timestamp: { type: 'date', accessor: 'tx.timestamp', operators: COMPARISON_OPERATORS },
};

export function getTxFilterField(field: string): TxFilterFieldDefinition {
    if (!Object.prototype.hasOwnProperty.call(TX_FILTER_FIELDS, field)) {
        throw new Error(`Unsupported transaction filter field "${field}"`);
    }
    return TX_FILTER_FIELDS[field];
}

export function getTxFilterOperator(operator: string): TxFilterOperatorDefinition {
    if (!Object.prototype.hasOwnProperty.call(TX_FILTER_OPERATORS, operator)) {
        throw new Error(`Unsupported transaction filter operator "${operator}"`);
    }
    return TX_FILTER_OPERATORS[operator as TxFilterOperatorName];
}
