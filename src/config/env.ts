import 'dotenv/config';

function parseOptionalBlock(name: string): number | undefined {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') return undefined;

    const blockNumber = Number(value);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
    }

    return blockNumber;
}

const rpcEndpoints = Object.entries(process.env)
    .flatMap(([name, value]) => {
        const match = /^RPC_URL_(\d+)$/.exec(name);
        if (!match || !value?.trim()) return [];
        return [{ name, index: Number(match[1]), url: value.trim() }];
    })
    .sort((left, right) => left.index - right.index);

const rpcUrls = rpcEndpoints.map((endpoint) => endpoint.url);

const chainIdValue = process.env.CHAIN_ID?.trim();
if (!chainIdValue || !/^(?:\d+|0x[0-9a-f]+)$/i.test(chainIdValue)) {
    throw new Error('CHAIN_ID must be configured as a decimal or hexadecimal EVM chain ID');
}
const chainId = BigInt(chainIdValue);
if (chainId <= 0n) {
    throw new Error('CHAIN_ID must be greater than zero');
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
    throw new Error('DATABASE_URL must be configured for PostgreSQL');
}

const blockchainNetworkAndDatabaseName = process.env.BLOCKCHAIN_NETWORK_AND_DATABASE_NAME?.trim();

if (!blockchainNetworkAndDatabaseName) {
    throw new Error('BLOCKCHAIN_NETWORK_AND_DATABASE_NAME must be configured');
}

if (!/^[a-zA-Z0-9_-]{1,63}$/.test(blockchainNetworkAndDatabaseName)) {
    throw new Error(
        'BLOCKCHAIN_NETWORK_AND_DATABASE_NAME must contain 1-63 letters, numbers, hyphens, or underscores',
    );
}

export const env = {
    blockchainNetworkAndDatabaseName,
    chainId,
    databaseUrl,
    rpcEndpoints,
    rpcUrls,
    startBlock: parseOptionalBlock('START_BLOCK'),
};
