import { isAddress } from 'ethers';
import { MAX_TX_FILTER_ADDRESSES } from '../constants/tx-filter.constants';
import { TX_FILTER_ADDRESS_VALIDATION } from '../constants/tx-filter-address.constants';
import type { TxFilterRule } from '../types/tx-filter.types';
import { ValidationError } from '../utils/validationError';
import { getTxFilterField, getTxFilterOperator, TX_FILTER_FIELDS } from './txFilterRegistry';
import type { TxFilterAddressKind, TxFilterOperatorName } from './txFilterRegistry';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAddressValues(
    rule: TxFilterRule,
    result: Array<{ kind: TxFilterAddressKind; value: string }>,
): void {
    if (!isRecord(rule)) return;

    const node = rule as Record<string, unknown>;

    if (Array.isArray(node.all)) {
        for (const child of node.all) getAddressValues(child as TxFilterRule, result);
        return;
    }
    if (Array.isArray(node.any)) {
        for (const child of node.any) getAddressValues(child as TxFilterRule, result);
        return;
    }
    if (node.not) {
        getAddressValues(node.not as TxFilterRule, result);
        return;
    }

    if (
        typeof node.field !== 'string' ||
        typeof node.op !== 'string' ||
        !Object.prototype.hasOwnProperty.call(TX_FILTER_FIELDS, node.field)
    ) {
        return;
    }

    const field = getTxFilterField(node.field);
    if (!field.addressKind || !field.operators.includes(node.op as TxFilterOperatorName)) return;

    const operator = getTxFilterOperator(node.op);
    const values =
        operator.valueMode === 'set' && Array.isArray(node.value) ? node.value : [node.value];

    for (const value of values) {
        if (typeof value === 'string') result.push({ kind: field.addressKind, value });
    }
}

export function validateTxFilterAddresses(rule: TxFilterRule): void {
    const addresses: Array<{ kind: TxFilterAddressKind; value: string }> = [];
    getAddressValues(rule, addresses);

    const uniqueAddressValues = new Set(addresses.map(({ value }) => value.toLowerCase()));
    if (uniqueAddressValues.size > MAX_TX_FILTER_ADDRESSES) {
        throw new ValidationError(
            `A transaction filter can contain a maximum of ${MAX_TX_FILTER_ADDRESSES} unique addresses`,
        );
    }

    const validated = new Set<string>();

    for (const { kind, value } of addresses) {
        if (!TX_FILTER_ADDRESS_VALIDATION[kind].ethers) continue;

        const key = `${kind}:${value.toLowerCase()}`;
        if (validated.has(key)) continue;

        if (!isAddress(value)) {
            throw new ValidationError(`Invalid Ethereum address: ${value}`);
        }

        validated.add(key);
    }
}
