import type { ActiveTxFilter } from '../../src/types/tx-filter.types';

export const mockDynamicSettings = {
    maxParallelBlocks: '3',
    pollIntervalMs: '4000',
};

export const mockActiveTxFilter: ActiveTxFilter = {
    id: 1,
    description: 'Native transfer filter',
    ruleSignature: 'mock-rule-signature',
    predicate: (transaction) => {
        const tx = transaction.tx as { transferType?: string } | undefined;
        return tx?.transferType === 'native';
    },
};
