export interface RpcLog {
    address: string;
    topics: string[];
    data: string;
    logIndex: string;
}

export interface RpcTransactionReceipt {
    transactionHash: string;
    blockHash: string;
    blockNumber: string;
    transactionIndex: string;
    gasUsed: string;
    cumulativeGasUsed: string;
    status: string | null;
    contractAddress: string | null;
    logsBloom: string;
    root: string | null;
    blobGasUsed?: string | null;
    logs: RpcLog[];
}
