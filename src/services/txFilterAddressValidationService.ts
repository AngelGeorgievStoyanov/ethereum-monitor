import { Contract, isAddress, ZeroAddress } from 'ethers';
import { getRpcClient } from '../clients/rpcClient';
import { TX_FILTER_ADDRESS_VALIDATION, ERC20_VALIDATION_ABI } from '../constants/tx-filter-address.constants';
import type { TxFilterRule } from '../types/tx-filter.types';
import { HttpError } from '../utils/httpError';
import { ValidationError } from '../utils/validationError';

type AddressValidationOptions = {
    ethers: boolean;
    onChain: boolean;
};

type AddressKind = 'address' | 'tokenContract';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getErrorCode(error: unknown): unknown {
    return typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
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

async function validateOnChainAddress(address: string): Promise<void> {
    try {
        await getRpcClient().execute('validateFilterAddress', async (provider) => {
            const [code, transactionCount] = await Promise.all([
                provider.getCode(address),
                provider.getTransactionCount(address),
            ]);

            if (typeof code !== 'string' || !Number.isSafeInteger(transactionCount)) {
                throw new Error('RPC returned an invalid address lookup response');
            }

            // An address with no code and no transaction history is still a valid address.
        });
    } catch (error) {
        if (getErrorCode(error) === 'INVALID_ARGUMENT') {
            throw new ValidationError(`Invalid Ethereum address: ${address}`);
        }
        throw new HttpError(503, 'On-chain address validation is temporarily unavailable');
    }
}

async function validateOnChainTokenContract(address: string): Promise<void> {
    try {
        await getRpcClient().execute('validateFilterTokenContract', async (provider) => {
            const code = await provider.getCode(address);
            if (!code || code === '0x' || code === '0x0') {
                throw new ValidationError(
                    `Token address ${address} does not contain a deployed contract`,
                );
            }

            const contract = new Contract(address, ERC20_VALIDATION_ABI, provider);
            try {
                const [totalSupply, balance] = await Promise.all([
                    contract.getFunction('totalSupply').staticCall(),
                    contract.getFunction('balanceOf').staticCall(ZeroAddress),
                ]);

                if (typeof totalSupply !== 'bigint' || typeof balance !== 'bigint') {
                    throw new ValidationError(
                        `Token address ${address} does not expose the expected ERC-20 interface`,
                    );
                }
            } catch (error) {
                if (error instanceof ValidationError) throw error;

                const code = getErrorCode(error);

                if (code === 'CALL_EXCEPTION' || code === 'BAD_DATA') {
                    throw new ValidationError(
                        `Token address ${address} does not expose the expected ERC-20 interface`,
                    );
                }
                throw error;
            }
        });
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        if (getErrorCode(error) === 'INVALID_ARGUMENT') {
            throw new ValidationError(`Invalid Ethereum address: ${address}`);
        }
        throw new HttpError(503, 'On-chain token validation is temporarily unavailable');
    }
}

async function validateAddress(
    address: string,
    kind: AddressKind,
    options: AddressValidationOptions,
): Promise<void> {
    if (options.ethers && !isAddress(address)) {
        throw new ValidationError(`Invalid Ethereum address: ${address}`);
    }

    if (!options.onChain) return;

    if (kind === 'tokenContract') {
        await validateOnChainTokenContract(address);
        return;
    }

    await validateOnChainAddress(address);
}

export async function validateTxFilterAddresses(rule: TxFilterRule): Promise<void> {
    const addresses: Array<{ kind: AddressKind; value: string }> = [];
    getAddressValues(rule, addresses);

    const validated = new Set<string>();

    for (const { kind, value } of addresses) {
        const options = TX_FILTER_ADDRESS_VALIDATION[kind];
        const key = `${kind}:${value.toLowerCase()}`;
        if (validated.has(key)) continue;

        await validateAddress(value, kind, options);
        validated.add(key);
    }
}
