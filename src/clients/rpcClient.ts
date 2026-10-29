import { JsonRpcProvider, toQuantity } from 'ethers';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { RPC_ENDPOINT_TIMEOUT_MS } from '../constants/ethereum-rpc.constants';
import { env } from '../config/env';
import { formatError } from '../utils/formatError';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`RPC request timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRetryableEndpointError(error: unknown): boolean {
    let details = '';

    try {
        details = JSON.stringify(error);
    } catch {
        details = String(error);
    }

    const message = error instanceof Error ? error.message : String(error);
    return /\b429\b|too many requests|-32005|rate.?limit|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|network error|\b50[234]\b/i.test(
        `${message} ${details}`,
    );
}

type RpcEndpoint = {
    index: number;
    provider: JsonRpcProvider;
    metrics: {
        attempts: number;
        successes: number;
        failures: number;
        retryableFailures: number;
        totalDurationMs: number;
        lastFailureAt: string | null;
    };
};

function recordEndpointAttempt(endpoint: RpcEndpoint): void {
    endpoint.metrics.attempts += 1;
}

function recordEndpointSuccess(endpoint: RpcEndpoint, startedAt: number): void {
    endpoint.metrics.successes += 1;
    endpoint.metrics.totalDurationMs += Date.now() - startedAt;
}

function recordEndpointFailure(
    endpoint: RpcEndpoint,
    startedAt: number,
    error?: unknown,
): void {
    endpoint.metrics.failures += 1;
    endpoint.metrics.totalDurationMs += Date.now() - startedAt;
    if (error !== undefined) {
        endpoint.metrics.lastFailureAt = new Date().toISOString();
        if (isRetryableEndpointError(error)) endpoint.metrics.retryableFailures += 1;
    }
}

export function createRpcClient() {
    if (env.rpcUrls.length === 0) {
        throw new Error('No RPC endpoints configured. Add RPC_URL_1, RPC_URL_2, etc. to .env');
    }

    const endpoints = env.rpcUrls.map((url, index) => ({
        index: index + 1,
        provider: new JsonRpcProvider(url),
        metrics: {
            attempts: 0,
            successes: 0,
            failures: 0,
            retryableFailures: 0,
            totalDurationMs: 0,
            lastFailureAt: null as string | null,
        },
    }));
    let nextEndpointIndex = 0;

    async function execute<T>(
        operationName: string,
        operation: (provider: JsonRpcProvider) => Promise<T>,
    ): Promise<T> {
        let lastError: unknown;

        for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
            const endpoint = endpoints[nextEndpointIndex];
            nextEndpointIndex = (nextEndpointIndex + 1) % endpoints.length;

            const startedAt = Date.now();
            endpoint.metrics.attempts += 1;

            try {
                const result = await withTimeout(
                    operation(endpoint.provider),
                    RPC_ENDPOINT_TIMEOUT_MS,
                );
                recordEndpointSuccess(endpoint, startedAt);
                return result;
            } catch (error) {
                recordEndpointFailure(endpoint, startedAt, error);
                lastError = error;
                if (!isRetryableEndpointError(error)) throw error;

                console.warn(
                    `[RPC] Endpoint ${endpoint.index} failed temporarily during ${operationName}; ` +
                        (attempt + 1 < endpoints.length
                            ? 'trying the next endpoint'
                            : 'all configured endpoints failed temporarily') +
                        `: ${formatError(error)}`,
                );
            }
        }

        throw lastError ?? new Error(`No RPC endpoint available for ${operationName}`);
    }

    async function getBlockFromAllEndpoints(blockNumber: number) {
        const results: Array<{
            endpointIndex: number;
            block: Awaited<ReturnType<JsonRpcProvider['getBlock']>> | null;
            error: string | null;
        }> = [];

        // Consensus requests are deliberately sequential to avoid increasing RPC pressure.
        for (const endpoint of endpoints) {
            const startedAt = Date.now();
            endpoint.metrics.attempts += 1;
            try {
                const block = await withTimeout(
                    endpoint.provider.getBlock(blockNumber),
                    RPC_ENDPOINT_TIMEOUT_MS,
                );
                if (block) recordEndpointSuccess(endpoint, startedAt);
                else recordEndpointFailure(endpoint, startedAt);
                results.push({
                    endpointIndex: endpoint.index,
                    block,
                    error: block ? null : 'EMPTY_BLOCK',
                });
            } catch (error) {
                const message = formatError(error);
                recordEndpointFailure(endpoint, startedAt, error);
                results.push({ endpointIndex: endpoint.index, block: null, error: message });
            }
        }

        return results;
    }

    async function getFinalizedFromAllEndpoints() {
        const results: Array<{
            endpointIndex: number;
            blockNumber: number | null;
            blockHash: string | null;
            error: string | null;
        }> = [];

        // Diagnostic only: inspect each endpoint once without waiting for consensus or blocking scanning.
        for (const endpoint of endpoints) {
            const startedAt = Date.now();
            endpoint.metrics.attempts += 1;
            try {
                const block = await withTimeout(
                    endpoint.provider.getBlock('finalized'),
                    RPC_ENDPOINT_TIMEOUT_MS,
                );
                if (block?.number !== undefined && block.hash) {
                    recordEndpointSuccess(endpoint, startedAt);
                    results.push({
                        endpointIndex: endpoint.index,
                        blockNumber: block.number,
                        blockHash: block.hash,
                        error: null,
                    });
                } else {
                    recordEndpointFailure(endpoint, startedAt);
                    results.push({
                        endpointIndex: endpoint.index,
                        blockNumber: block?.number ?? null,
                        blockHash: block?.hash ?? null,
                        error: 'EMPTY_FINALIZED_BLOCK',
                    });
                }
            } catch (error) {
                const message = formatError(error);
                recordEndpointFailure(endpoint, startedAt, error);
                results.push({
                    endpointIndex: endpoint.index,
                    blockNumber: null,
                    blockHash: null,
                    error: message,
                });
            }
        }

        return results;
    }

    async function getBlockAndReceipts(blockNumber: number) {
        let getBlockDurationMs = 0;
        let getBlockReceiptsDurationMs = 0;

        const result = await execute(`getBlockAndReceipts(${blockNumber})`, async (provider) => {
            const getBlockStartedAt = Date.now();
            const block = await provider.getBlock(blockNumber, true);
            getBlockDurationMs = Date.now() - getBlockStartedAt;

            if (!block) {
                throw new Error(`Unable to load block ${blockNumber}`);
            }

            const getReceiptsStartedAt = Date.now();
            const response: unknown = await provider.send('eth_getBlockReceipts', [
                toQuantity(blockNumber),
            ]);
            getBlockReceiptsDurationMs = Date.now() - getReceiptsStartedAt;

            if (!Array.isArray(response)) {
                throw new Error('eth_getBlockReceipts returned a non-array response');
            }

            return { block, receipts: response as RpcTransactionReceipt[] };
        });

        return { ...result, getBlockDurationMs, getBlockReceiptsDurationMs };
    }

    return {
        execute,
        getBlockAndReceipts,
        getBlockFromAllEndpoints,
        getFinalizedFromAllEndpoints,
        getBlock(blockTag: string | number, includeTransactions = false) {
            return execute(`getBlock(${String(blockTag)})`, (provider) =>
                provider.getBlock(blockTag, includeTransactions),
            );
        },
        send(method: string, params: unknown[]) {
            return execute(method, (provider) => provider.send(method, params));
        },
        getEndpointCount: () => endpoints.length,
        getMetrics: () =>
            endpoints.map(({ index, metrics }) => ({
                index,
                ...metrics,
            })),
    };
}

let rpcClientInstance: ReturnType<typeof createRpcClient> | undefined;

export function getRpcClient() {
    if (!rpcClientInstance) {
        rpcClientInstance = createRpcClient();
        console.log(`[RPC] Loaded ${rpcClientInstance.getEndpointCount()} endpoint(s)`);
    }

    return rpcClientInstance;
}
