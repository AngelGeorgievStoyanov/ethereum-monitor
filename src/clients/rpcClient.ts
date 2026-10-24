import { JsonRpcProvider } from 'ethers';
import { env } from '../config/env';
import { formatError } from '../utils/formatError';

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

export function createRpcClient() {
    if (env.rpcUrls.length === 0) {
        throw new Error('No RPC endpoints configured. Add RPC_URL_1, RPC_URL_2, etc. to .env');
    }

    const endpoints = env.rpcUrls.map((url, index) => ({
        index: index + 1,
        provider: new JsonRpcProvider(url),
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

            try {
                return await operation(endpoint.provider);
            } catch (error) {
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

    return {
        getBlock(blockTag: string | number, includeTransactions = false) {
            return execute(`getBlock(${String(blockTag)})`, (provider) =>
                provider.getBlock(blockTag, includeTransactions),
            );
        },
        send(method: string, params: unknown[]) {
            return execute(method, (provider) => provider.send(method, params));
        },
        getEndpointCount: () => endpoints.length,
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
