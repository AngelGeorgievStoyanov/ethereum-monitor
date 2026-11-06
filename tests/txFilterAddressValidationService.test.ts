import { describe, expect, it } from 'vitest';
import { MAX_TX_FILTER_ADDRESSES } from '../src/constants/tx-filter.constants';
import { validateTxFilterAddresses } from '../src/services/txFilterAddressValidationService';
import {
    createAddressSetRule,
    invalidAddressRule,
    validAddress,
    validAddressRule,
} from './mock/txFilterAddressValidationService.mock';

describe('txFilterAddressValidationService', () => {
    it('accepts a valid EVM address', () => {
        expect(() => validateTxFilterAddresses(validAddressRule)).not.toThrow();
    });

    it('rejects malformed EVM addresses', () => {
        expect(() => validateTxFilterAddresses(invalidAddressRule)).toThrow('Invalid EVM address');
    });

    it('validates token contract addresses as well as wallet addresses', () => {
        expect(() =>
            validateTxFilterAddresses({
                field: 'tokenAddress',
                op: 'eq',
                value: validAddress,
            }),
        ).not.toThrow();
    });

    it('accepts the configured maximum number of unique addresses', () => {
        expect(() =>
            validateTxFilterAddresses(createAddressSetRule(MAX_TX_FILTER_ADDRESSES)),
        ).not.toThrow();
    });

    it('rejects more than the configured maximum number of unique addresses', () => {
        expect(() =>
            validateTxFilterAddresses(createAddressSetRule(MAX_TX_FILTER_ADDRESSES + 1)),
        ).toThrow(`maximum of ${MAX_TX_FILTER_ADDRESSES} unique addresses`);
    });

    it('counts duplicate addresses only once regardless of letter casing', () => {
        const upperCaseAddress = validAddress.toUpperCase().replace('0X', '0x');
        expect(() =>
            validateTxFilterAddresses({
                field: 'from',
                op: 'in',
                value: [validAddress, upperCaseAddress],
            }),
        ).not.toThrow();
    });
});
