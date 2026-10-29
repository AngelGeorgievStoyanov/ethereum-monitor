import { TX_FILTER_RELOAD_RETRY_DELAYS_MS } from '../constants/tx-filter.constants';

export type TxFilterMutationOperation = 'created' | 'updated' | 'deleted';

export interface TxFilterSyncFailureResponse {
    message: string;
    scannerSync: 'out_of_sync';
    data: unknown;
}

export function mapTxFilterSyncFailureResponse(
    operation: TxFilterMutationOperation,
    result: unknown,
): TxFilterSyncFailureResponse {
    const action = {
        created: 'Filter saved to the database',
        updated: 'Filter changes were saved to the database',
        deleted: 'Filter was deleted from the database',
    }[operation];

    return {
        message: `${action}, but the scanner is still using its previous filters. Reload failed after ${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1} attempts.`,
        scannerSync: 'out_of_sync',
        data: result,
    };
}
