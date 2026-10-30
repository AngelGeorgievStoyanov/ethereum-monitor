export interface TxFilterConditionRule {
    field: string;
    operator: string;
    value: unknown;
}

export interface TxFilterGroupRule {
    logic: 'AND' | 'OR';
    conditions: TxFilterConditionRule[];
    groups: TxFilterGroupRule[];
}

export interface ActiveTxFilter {
    id: number;
    description: string;
    isActive: boolean;
    activeFromBlock: number | null;
    rule: TxFilterGroupRule;
}

export interface TransactionFilterContext {
    [field: string]: unknown;
}

export interface TxFilterRecord {
    id: number;
    description: string;
    from: string | null;
    to: string | null;
    isActive: boolean;
    activeFromBlock: number | null;
}
