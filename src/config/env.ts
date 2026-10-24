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

const rpcUrls = Object.entries(process.env)
    .flatMap(([name, value]) => {
        const match = /^RPC_URL_(\d+)$/.exec(name);
        return match && value?.trim() ? [{ index: Number(match[1]), url: value.trim() }] : [];
    })
    .sort((left, right) => left.index - right.index)
    .map((item) => item.url);

export const env = {
    databaseUrl: process.env.DATABASE_URL || 'sqlite:./db.sqlite',
    rpcUrls,
    startBlock: parseOptionalBlock('START_BLOCK'),
    rescanFromBlock: parseOptionalBlock('RESCAN_FROM_BLOCK'),
};
