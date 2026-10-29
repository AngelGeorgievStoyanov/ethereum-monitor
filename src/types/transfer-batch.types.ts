import type { TransactionResponse } from 'ethers';
import type { RpcTransactionReceipt } from './evm-rpc.types';
import type { ActiveTxFilter } from './tx-filter.types';
import type { TransferContextMetadata } from './transaction.types';

export interface TransferBatchCandidate {
    tx: TransactionResponse;
    receipt: RpcTransactionReceipt;
    blockTimestamp: number;
    transfer: TransferContextMetadata;
    matchingTxFilters: ActiveTxFilter[];
}
