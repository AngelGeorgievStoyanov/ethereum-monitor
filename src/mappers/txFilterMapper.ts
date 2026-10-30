import type { TxFilterGroupRule, TxFilterRecord } from '../types/tx-filter.types';

export interface TxFilterResponse extends TxFilterRecord {
    rule: TxFilterGroupRule | null;
}

export function mapTxFilterResponse(
    filter: TxFilterRecord,
    rule: TxFilterGroupRule | null,
): TxFilterResponse {
    return {
        id: filter.id,
        description: filter.description,
        from: filter.from,
        to: filter.to,
        isActive: filter.isActive,
        activeFromBlock: filter.activeFromBlock,
        rule,
    };
}

export function mapTxFilterListResponse(
    filters: readonly TxFilterRecord[],
    rulesByFilterId: ReadonlyMap<number, TxFilterGroupRule | null>,
): TxFilterResponse[] {
    return filters.map((filter) =>
        mapTxFilterResponse(filter, rulesByFilterId.get(filter.id) ?? null),
    );
}
