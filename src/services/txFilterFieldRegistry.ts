export type TxFilterFieldType = 'string' | 'number' | 'bigint' | 'date';

export interface TxFilterFieldDefinition {
    type: TxFilterFieldType;
    accessor: string;
    normalize?: 'lowercase';
}

export const TX_FILTER_FIELDS: Record<string, TxFilterFieldDefinition> = {
    txHash: { type: 'string', accessor: 'tx.txHash', normalize: 'lowercase' },
    transferType: { type: 'string', accessor: 'tx.transferType', normalize: 'lowercase' },
    tokenAddress: { type: 'string', accessor: 'tx.tokenAddress', normalize: 'lowercase' },
    logIndex: { type: 'number', accessor: 'tx.logIndex' },
    nonce: { type: 'number', accessor: 'tx.nonce' },
    blockHash: { type: 'string', accessor: 'tx.blockHash', normalize: 'lowercase' },
    blockNumber: { type: 'number', accessor: 'tx.blockNumber' },
    transactionIndex: { type: 'number', accessor: 'tx.transactionIndex' },
    from: { type: 'string', accessor: 'tx.from', normalize: 'lowercase' },
    to: { type: 'string', accessor: 'tx.to', normalize: 'lowercase' },
    value: { type: 'bigint', accessor: 'tx.value' },
    internalCount: { type: 'number', accessor: 'tx.internalCount' },
    status: { type: 'string', accessor: 'tx.status', normalize: 'lowercase' },
    transactionType: { type: 'string', accessor: 'tx.transactionType', normalize: 'lowercase' },
    timestamp: { type: 'date', accessor: 'tx.timestamp' },
};

export function getTxFilterField(field: string): TxFilterFieldDefinition {
    if (!Object.prototype.hasOwnProperty.call(TX_FILTER_FIELDS, field)) {
        throw new Error(`Unsupported transaction filter field "${field}"`);
    }
    const definition = TX_FILTER_FIELDS[field];
    return definition;
}
