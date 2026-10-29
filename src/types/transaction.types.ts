export type StoredTransferType = 'native' | 'erc20' | 'internal';
export type StoredTransactionChainStatus = 'SUCCESS' | 'FAILED';
export type StoredTransactionRecordStatus = 'NORMAL' | 'REORGED';
export type StoredTransactionMatchStatus = 'ACTIVE' | 'NOT_MATCHED' | 'FILTER_DELETED' | 'REORGED';

export interface TransferContextMetadata {
    transferType: 'native' | 'erc20';
    tokenAddress?: string | null;
    logIndex: number;
    from: string;
    to: string;
    value: string;
}

export interface TransferBatchItem {
    data: TransactionPersistenceData;
    matchingTxFilters: Array<{ id: number; description: string }>;
}

export interface TransactionPersistenceData {
    txHash: string;
    transferType: StoredTransferType;
    tokenAddress?: string | null;
    logIndex: number;
    nonce: number;
    blockHash: string;
    blockNumber: number;
    transactionIndex: number;
    from: string;
    to?: string | null;
    value: string;
    internalCount?: number | null;
    chainStatus: StoredTransactionChainStatus;
    recordStatus?: StoredTransactionRecordStatus;
    transactionType?: string;
    timestamp?: Date;
}

export interface StoredTransactionRecord {
    id: number;
    txHash: string;
    transferType: StoredTransferType;
    tokenAddress: string | null;
    logIndex: number;
    nonce: number;
    blockHash: string;
    blockNumber: number;
    transactionIndex: number;
    from: string;
    to: string | null;
    value: string;
    internalCount: number | null;
    chainStatus: StoredTransactionChainStatus;
    recordStatus: StoredTransactionRecordStatus;
    transactionType: string | null;
    timestamp: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface StoredTxFilterRecord {
    id: number;
    description: string;
    from: string | null;
    to: string | null;
    isActive: boolean;
    activeFromBlock: number | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface StoredTransactionMatchRecord {
    id: number;
    txId: number;
    txFilterId: number | null;
    txFilterDescription: string | null;
    matchStatus: StoredTransactionMatchStatus;
    createdAt: Date;
    updatedAt: Date;
    txFilter: StoredTxFilterRecord | null;
}

export interface StoredTransactionPageRecord extends StoredTransactionRecord {
    matches: StoredTransactionMatchRecord[];
}

export interface StoredTransactionPage {
    items: StoredTransactionPageRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type TransactionResponseDto = Omit<StoredTransactionRecord, 'timestamp' | 'createdAt' | 'updatedAt'> & {
    timestamp: string | null;
    createdAt: string;
    updatedAt: string;
    matches: Array<Omit<StoredTransactionMatchRecord, 'createdAt' | 'updatedAt' | 'txFilter'> & {
        createdAt: string;
        updatedAt: string;
        txFilter: (Omit<StoredTxFilterRecord, 'createdAt' | 'updatedAt'> & {
            createdAt: string;
            updatedAt: string;
        }) | null;
    }>;
};

export interface TransactionPageResponse {
    items: TransactionResponseDto[];
    pagination: StoredTransactionPage['pagination'];
}
