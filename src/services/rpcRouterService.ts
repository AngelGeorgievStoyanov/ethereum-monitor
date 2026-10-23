import { JsonRpcProvider } from 'ethers';
import { formatError } from '../utils/formatError';
import { getRpcProviderService } from './rpcProviderService';

function isRateLimitError(error: unknown): boolean {
    let details = '';

    try {
        details = JSON.stringify(error);
    } catch {
        details = String(error);
    }

    const message = error instanceof Error ? error.message : String(error);
    return /\b429\b|too many requests|-32005|rate.?limit/i.test(`${message} ${details}`);
}

export function createRpcRouterService() {
    const providerService = getRpcProviderService();
    const endpoints = providerService.getEndpoints();
    let nextEndpointIndex = 0;

    async function execute<T>(
        operationName: string,
        operation: (provider: JsonRpcProvider) => Promise<T>
    ): Promise<T> {
        let lastError: unknown;

        for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
            const endpointIndex = nextEndpointIndex;
            const endpoint = endpoints[endpointIndex];
            nextEndpointIndex = (nextEndpointIndex + 1) % endpoints.length;

            try {
                return await operation(endpoint.provider);
            } catch (error) {
                lastError = error;

                if (!isRateLimitError(error)) {
                    throw error;
                }

                console.warn(
                    `[RPC Router] Endpoint ${endpoint.index} rate-limited during ${operationName}; `
                    + (attempt + 1 < endpoints.length
                        ? 'trying the next endpoint'
                        : 'all configured endpoints were rate-limited')
                    + `: ${formatError(error)}`
                );
            }
        }

        throw lastError ?? new Error(`No RPC endpoint available for ${operationName}`);
    }

    return {
        getBlock(blockTag: string | number, includeTransactions = false) {
            return execute(
                `getBlock(${String(blockTag)})`,
                provider => provider.getBlock(blockTag, includeTransactions)
            );
        },
        send(method: string, params: unknown[]) {
            return execute(method, provider => provider.send(method, params));
        },
        getEndpointCount: () => endpoints.length,
    };
}

let rpcRouterServiceInstance: ReturnType<typeof createRpcRouterService> | undefined;

export function getRpcRouterService() {
    if (!rpcRouterServiceInstance) {
        rpcRouterServiceInstance = createRpcRouterService();
        console.log(
            `[RPC Router] Loaded ${rpcRouterServiceInstance.getEndpointCount()} RPC endpoint(s)`
        );
    }

    return rpcRouterServiceInstance;
}
