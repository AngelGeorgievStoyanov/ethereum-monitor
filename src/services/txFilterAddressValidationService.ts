import { isAddress } from 'ethers';
import {
    MAX_TX_FILTER_ADDRESSES,
} from '../constants/tx-filter.constants';
import { TX_FILTER_ADDRESS_VALIDATION } from '../constants/tx-filter-address.constants';
import type { TxFilterRule } from '../types/tx-filter.types';
import { ValidationError } from '../utils/validationError';

type AddressKind = 'address' | 'tokenContract';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAddressValues(
    rule: TxFilterRule,
    result: Array<{ kind: AddressKind; value: string }>,
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

    const field = node.field;
    const operator = node.op;
    if (field !== 'from' && field !== 'to' && field !== 'tokenAddress') return;
    if (!['eq', 'ne', 'in', 'notIn'].includes(String(operator))) return;

    const kind: AddressKind = field === 'tokenAddress' ? 'tokenContract' : 'address';
    const values = Array.isArray(node.value) ? node.value : [node.value];

    for (const value of values) {
        if (typeof value === 'string') result.push({ kind, value });
    }
}

export async function validateTxFilterAddresses(rule: TxFilterRule): Promise<void> {
    const addresses: Array<{ kind: AddressKind; value: string }> = [];
    getAddressValues(rule, addresses);

    const uniqueAddressValues = new Set(addresses.map(({ value }) => value.toLowerCase()));
    if (uniqueAddressValues.size > MAX_TX_FILTER_ADDRESSES) {
        throw new ValidationError(
            `A transaction filter can contain a maximum of ${MAX_TX_FILTER_ADDRESSES} unique addresses`,
        );
    }

    const validated = new Set<string>();

    for (const { kind, value } of addresses) {
        const options = TX_FILTER_ADDRESS_VALIDATION[kind];
        if (!options.ethers) continue;

        const key = `${kind}:${value.toLowerCase()}`;
        if (validated.has(key)) continue;

        if (!isAddress(value)) {
            throw new ValidationError(`Invalid Ethereum address: ${value}`);
        }

        validated.add(key);
    }
}
