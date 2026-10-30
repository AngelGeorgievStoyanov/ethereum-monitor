export type TxFilterFieldType = 'string' | 'number' | 'bigint' | 'date';

export interface TxFilterFieldDefinition {
    type: TxFilterFieldType;
    caseInsensitive?: boolean;
}

export const TX_FILTER_FIELDS: Record<string, TxFilterFieldDefinition> = {
    txHash: { type: 'string', caseInsensitive: true },
    transferType: { type: 'string', caseInsensitive: true },
    tokenAddress: { type: 'string', caseInsensitive: true },
    logIndex: { type: 'number' },
    nonce: { type: 'number' },
    blockHash: { type: 'string', caseInsensitive: true },
    blockNumber: { type: 'number' },
    transactionIndex: { type: 'number' },
    from: { type: 'string', caseInsensitive: true },
    to: { type: 'string', caseInsensitive: true },
    value: { type: 'bigint' },
    internalCount: { type: 'number' },
    status: { type: 'string', caseInsensitive: true },
    transactionType: { type: 'string', caseInsensitive: true },
    timestamp: { type: 'date' },
};

export function getTxFilterField(field: string): TxFilterFieldDefinition {
    const definition = TX_FILTER_FIELDS[field];
    if (!definition) throw new Error(`Unsupported transaction filter field "${field}"`);
    return definition;
}
