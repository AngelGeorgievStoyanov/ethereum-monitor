import type { TxFilterRecord, TxFilterRule } from '../types/tx-filter.types';

export interface TxFilterResponse extends TxFilterRecord {
    rule: TxFilterRule;
}

export function mapTxFilterResponse(filter: TxFilterRecord): TxFilterResponse {
    return {
        id: filter.id,
        description: filter.description,
        isActive: filter.isActive,
        rule: filter.rule,
    };
}

export function mapTxFilterListResponse(filters: readonly TxFilterRecord[]): TxFilterResponse[] {
    return filters.map(mapTxFilterResponse);
}
