export interface TxFilterConditionRule {
    field: string;
    op: string;
    value: unknown;
}

export type TxFilterRule =
    | TxFilterConditionRule
    | { all: TxFilterRule[] }
    | { any: TxFilterRule[] }
    | { not: TxFilterRule };

export type TransactionFilterContext = Record<string, unknown>;
export type CompiledTxFilter = (transaction: TransactionFilterContext) => boolean;

export interface ActiveTxFilter {
    id: number;
    description: string;
    rule: TxFilterRule;
    predicate: CompiledTxFilter;
}

export interface TxFilterConfigSnapshot {
    version: string;
    filters: ActiveTxFilter[];
}

export interface TxFilterRecord {
    id: number;
    description: string;
    isActive: boolean;
    rule: TxFilterRule;
}
