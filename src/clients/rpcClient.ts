import { JsonRpcProvider, toQuantity } from 'ethers';
import { RpcTransactionReceipt } from '../types/evm-rpc.types';
import { RPC_ENDPOINT_TIMEOUT_MS } from '../constants/evm-rpc.constants';
import { env } from '../config/env';
import { formatError } from '../utils/formatError';
import { publishRpcMetricEvent, publishRpcOperationMetricEvent } from '../metrics/metricsEventBus';
import { classifyRpcError } from '../utils/classifyRpcError';

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
    classification?: ReturnType<typeof classifyRpcError>,
): void {
    endpoint.metrics.failures += 1;
    endpoint.metrics.totalDurationMs += Date.now() - startedAt;
    if (classification) {
        endpoint.metrics.lastFailureAt = new Date().toISOString();
        if (classification.retryable) endpoint.metrics.retryableFailures += 1;
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
        operation: (
            provider: JsonRpcProvider,
            endpointIndex: number,
            classifyError: (error: unknown) => ReturnType<typeof classifyRpcError>,
        ) => Promise<T>,
        publishMetrics = true,
        timeoutMs = RPC_ENDPOINT_TIMEOUT_MS,
        trackEndpointMetrics = true,
    ): Promise<T> {
        let lastError: unknown;
        let lastClassifiedError: unknown;
        let lastClassification: ReturnType<typeof classifyRpcError> | undefined;
        let hasClassification = false;
        const classifyError = (error: unknown) => {
            if (hasClassification && Object.is(error, lastClassifiedError) && lastClassification) {
                return lastClassification;
            }

            lastClassifiedError = error;
            lastClassification = classifyRpcError(error);
            hasClassification = true;
            return lastClassification;
        };
        const operationStartedAt = Date.now();
        let attempts = 0;
        const publishOperationResult = (outcome: 'success' | 'failure') => {
            publishRpcOperationMetricEvent({
                operation: operationName,
                durationMs: Date.now() - operationStartedAt,
                attempts,
                retryCount: Math.max(0, attempts - 1),
                endpointFailovers: Math.max(0, attempts - 1),
                outcome,
            });
        };

        for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
            const endpoint = endpoints[nextEndpointIndex];
            nextEndpointIndex = (nextEndpointIndex + 1) % endpoints.length;

            const startedAt = Date.now();
            attempts += 1;
            if (trackEndpointMetrics) recordEndpointAttempt(endpoint);

            try {
                const result = await withTimeout(
                    operation(endpoint.provider, endpoint.index, classifyError),
                    timeoutMs,
                );
                if (trackEndpointMetrics) recordEndpointSuccess(endpoint, startedAt);
                if (publishMetrics) publishRpcMetricEvent({ method: operationName, endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'success' });
                publishOperationResult('success');
                return result;
            } catch (error) {
                const classification = classifyError(error);
                if (trackEndpointMetrics) recordEndpointFailure(endpoint, startedAt, classification);
                if (publishMetrics) publishRpcMetricEvent({ method: operationName, endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'failure', message: formatError(error), retryable: classification.retryable, errorCategory: classification.category, httpStatus: classification.httpStatus, rpcCode: classification.rpcCode });
                lastError = error;
                if (!classification.retryable) {
                    publishOperationResult('failure');
                    throw error;
                }

                console.warn(
                    `[RPC] Endpoint ${endpoint.index} failed temporarily during ${operationName}; ` +
                        (attempt + 1 < endpoints.length
                            ? 'trying the next endpoint'
                            : 'all configured endpoints failed temporarily') +
                        `: ${formatError(error)}`,
                );
            }
        }

        publishOperationResult('failure');
        throw lastError ?? new Error(`No RPC endpoint available for ${operationName}`);
    }

    async function getBlockFromAllEndpoints(blockNumber: number, fullBlockEndpointIndex?: number) {
        const operationStartedAt = Date.now();
        const results: Array<{
            endpointIndex: number;
            block: Awaited<ReturnType<JsonRpcProvider['getBlock']>> | null;
            error: string | null;
            durationMs: number;
        }> = [];

        // Consensus requests are deliberately sequential to avoid increasing RPC pressure.
        for (const endpoint of endpoints) {
            const startedAt = Date.now();
            recordEndpointAttempt(endpoint);
            try {
                const block = await withTimeout(
                    endpoint.provider.getBlock(blockNumber, endpoint.index === fullBlockEndpointIndex),
                    RPC_ENDPOINT_TIMEOUT_MS,
                );
                if (block) {
                    recordEndpointSuccess(endpoint, startedAt);
                    publishRpcMetricEvent({ method: 'getBlock(consensus)', endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'success' });
                } else {
                    recordEndpointFailure(endpoint, startedAt);
                    publishRpcMetricEvent({ method: 'getBlock(consensus)', endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'failure', message: 'EMPTY_BLOCK' });
                }
                results.push({
                    endpointIndex: endpoint.index,
                    block,
                    error: block ? null : 'EMPTY_BLOCK',
                    durationMs: Date.now() - startedAt,
                });
            } catch (error) {
                const message = formatError(error);
                const classification = classifyRpcError(error);
                recordEndpointFailure(endpoint, startedAt, classification);
                publishRpcMetricEvent({ method: 'getBlock(consensus)', endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'failure', message, retryable: classification.retryable, errorCategory: classification.category, httpStatus: classification.httpStatus, rpcCode: classification.rpcCode });
                results.push({ endpointIndex: endpoint.index, block: null, error: message, durationMs: Date.now() - startedAt });
            }
        }

        publishRpcOperationMetricEvent({
            operation: 'getBlockFromAllEndpoints',
            durationMs: Date.now() - operationStartedAt,
            attempts: 1,
            retryCount: 0,
            endpointFailovers: 0,
            outcome: results.every((result) => result.error === null) ? 'success' : 'failure',
        });
        return results;
    }

    async function getBlockReceiptsFromEndpoint(blockNumber: number, endpointIndex: number) {
        const endpoint = endpoints.find((item) => item.index === endpointIndex);
        if (!endpoint) throw new Error(`RPC endpoint ${endpointIndex} is not configured`);

        const startedAt = Date.now();
        recordEndpointAttempt(endpoint);
        try {
            const response = await withTimeout(
                endpoint.provider.send('eth_getBlockReceipts', [toQuantity(blockNumber)]),
                RPC_ENDPOINT_TIMEOUT_MS,
            );
            const durationMs = Date.now() - startedAt;
            if (!Array.isArray(response)) {
                throw new Error('eth_getBlockReceipts returned a non-array response');
            }
            recordEndpointSuccess(endpoint, startedAt);
            publishRpcMetricEvent({ method: 'eth_getBlockReceipts', endpointIndex, durationMs, outcome: 'success' });
            publishRpcOperationMetricEvent({
                operation: `getBlockReceiptsFromEndpoint(${blockNumber})`,
                durationMs,
                attempts: 1,
                retryCount: 0,
                endpointFailovers: 0,
                outcome: 'success',
            });
            return { receipts: response as RpcTransactionReceipt[], durationMs };
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const classification = classifyRpcError(error);
            recordEndpointFailure(endpoint, startedAt, classification);
            publishRpcMetricEvent({ method: 'eth_getBlockReceipts', endpointIndex, durationMs, outcome: 'failure', message: formatError(error), retryable: classification.retryable, errorCategory: classification.category, httpStatus: classification.httpStatus, rpcCode: classification.rpcCode });
            publishRpcOperationMetricEvent({
                operation: `getBlockReceiptsFromEndpoint(${blockNumber})`,
                durationMs,
                attempts: 1,
                retryCount: 0,
                endpointFailovers: 0,
                outcome: 'failure',
            });
            throw error;
        }
    }

    async function getFinalizedFromAllEndpoints() {
        const operationStartedAt = Date.now();
        const results: Array<{
            endpointIndex: number;
            blockNumber: number | null;
            blockHash: string | null;
            error: string | null;
        }> = [];

        // Diagnostic only: inspect each endpoint once without waiting for consensus or blocking scanning.
        for (const endpoint of endpoints) {
            const startedAt = Date.now();
            recordEndpointAttempt(endpoint);
            try {
                const block = await withTimeout(
                    endpoint.provider.getBlock('finalized'),
                    RPC_ENDPOINT_TIMEOUT_MS,
                );
                if (block?.number !== undefined && block.hash) {
                    recordEndpointSuccess(endpoint, startedAt);
                    publishRpcMetricEvent({ method: 'getBlock(finalized,diagnostic)', endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'success' });
                    results.push({
                        endpointIndex: endpoint.index,
                        blockNumber: block.number,
                        blockHash: block.hash,
                        error: null,
                    });
                } else {
                    recordEndpointFailure(endpoint, startedAt);
                    publishRpcMetricEvent({ method: 'getBlock(finalized,diagnostic)', endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'failure', message: 'EMPTY_FINALIZED_BLOCK' });
                    results.push({
                        endpointIndex: endpoint.index,
                        blockNumber: block?.number ?? null,
                        blockHash: block?.hash ?? null,
                        error: 'EMPTY_FINALIZED_BLOCK',
                    });
                }
            } catch (error) {
                const message = formatError(error);
                const classification = classifyRpcError(error);
                recordEndpointFailure(endpoint, startedAt, classification);
                publishRpcMetricEvent({ method: 'getBlock(finalized,diagnostic)', endpointIndex: endpoint.index, durationMs: Date.now() - startedAt, outcome: 'failure', message, retryable: classification.retryable, errorCategory: classification.category, httpStatus: classification.httpStatus, rpcCode: classification.rpcCode });
                results.push({
                    endpointIndex: endpoint.index,
                    blockNumber: null,
                    blockHash: null,
                    error: message,
                });
            }
        }

        publishRpcOperationMetricEvent({
            operation: 'getFinalizedFromAllEndpoints',
            durationMs: Date.now() - operationStartedAt,
            attempts: 1,
            retryCount: 0,
            endpointFailovers: 0,
            outcome: results.every((result) => result.error === null) ? 'success' : 'failure',
        });
        return results;
    }

    async function getBlockAndReceipts(blockNumber: number) {
        let getBlockDurationMs = 0;
        let getBlockReceiptsDurationMs = 0;

        const result = await execute(`getBlockAndReceipts(${blockNumber})`, async (provider, endpointIndex, classifyError) => {
            const getBlockStartedAt = Date.now();
            let block;
            try {
                const endpoint = endpoints[endpointIndex - 1];
                recordEndpointAttempt(endpoint);
                block = await withTimeout(provider.getBlock(blockNumber, true), RPC_ENDPOINT_TIMEOUT_MS);
                getBlockDurationMs = Date.now() - getBlockStartedAt;
                if (block) recordEndpointSuccess(endpoint, getBlockStartedAt);
                else recordEndpointFailure(endpoint, getBlockStartedAt);
                publishRpcMetricEvent({ method: 'eth_getBlockByNumber', endpointIndex, durationMs: getBlockDurationMs, outcome: block ? 'success' : 'failure', message: block ? undefined : 'EMPTY_BLOCK' });
            } catch (error) {
                getBlockDurationMs = Date.now() - getBlockStartedAt;
                const classification = classifyError(error);
                recordEndpointFailure(endpoints[endpointIndex - 1], getBlockStartedAt, classification);
                publishRpcMetricEvent({ method: 'eth_getBlockByNumber', endpointIndex, durationMs: getBlockDurationMs, outcome: 'failure', message: formatError(error), retryable: classification.retryable, errorCategory: classification.category, httpStatus: classification.httpStatus, rpcCode: classification.rpcCode });
                throw error;
            }

            if (!block) {
                throw new Error(`Unable to load block ${blockNumber}`);
            }

            const getReceiptsStartedAt = Date.now();
            let response: unknown;
            try {
                const endpoint = endpoints[endpointIndex - 1];
                recordEndpointAttempt(endpoint);
                response = await withTimeout(provider.send('eth_getBlockReceipts', [toQuantity(blockNumber)]), RPC_ENDPOINT_TIMEOUT_MS);
                getBlockReceiptsDurationMs = Date.now() - getReceiptsStartedAt;
                recordEndpointSuccess(endpoint, getReceiptsStartedAt);
                publishRpcMetricEvent({ method: 'eth_getBlockReceipts', endpointIndex, durationMs: getBlockReceiptsDurationMs, outcome: 'success' });
            } catch (error) {
                getBlockReceiptsDurationMs = Date.now() - getReceiptsStartedAt;
                const classification = classifyError(error);
                recordEndpointFailure(endpoints[endpointIndex - 1], getReceiptsStartedAt, classification);
                publishRpcMetricEvent({ method: 'eth_getBlockReceipts', endpointIndex, durationMs: getBlockReceiptsDurationMs, outcome: 'failure', message: formatError(error), retryable: classification.retryable, errorCategory: classification.category, httpStatus: classification.httpStatus, rpcCode: classification.rpcCode });
                throw error;
            }

            if (!Array.isArray(response)) {
                throw new Error('eth_getBlockReceipts returned a non-array response');
            }

            return { block, receipts: response as RpcTransactionReceipt[] };
        }, false, RPC_ENDPOINT_TIMEOUT_MS * 2, false);

        return { ...result, getBlockDurationMs, getBlockReceiptsDurationMs };
    }

    return {
        execute,
        getBlockAndReceipts,
        getBlockFromAllEndpoints,
        getBlockReceiptsFromEndpoint,
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
