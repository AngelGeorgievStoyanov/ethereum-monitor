export type TxFilterValue = string | number | boolean | null | TxFilterValue[] | { [key: string]: TxFilterValue };

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
    isActive: boolean;
    activeFromBlock: number | null;
    rule: TxFilterRule;
    predicate: CompiledTxFilter;
}

export interface TxFilterRecord {
    id: number;
    description: string;
    isActive: boolean;
    activeFromBlock: number | null;
    rule: TxFilterRule;
}
