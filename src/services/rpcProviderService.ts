import { JsonRpcProvider } from 'ethers';
import { env } from '../config/env';

export interface RpcEndpoint {
    index: number;
    provider: JsonRpcProvider;
}

export function createRpcProviderService() {
    if (env.rpcUrls.length === 0) {
        throw new Error('No RPC endpoints configured. Add RPC_URL_1, RPC_URL_2, etc. to .env');
    }

    const endpoints: RpcEndpoint[] = env.rpcUrls.map((url, index) => ({
        index: index + 1,
        provider: new JsonRpcProvider(url),
    }));

    return {
        getEndpoints: () => endpoints,
        getEndpointCount: () => endpoints.length,
    };
}

let rpcProviderServiceInstance: ReturnType<typeof createRpcProviderService> | undefined;

export function getRpcProviderService() {
    if (!rpcProviderServiceInstance) {
        rpcProviderServiceInstance = createRpcProviderService();
    }

    return rpcProviderServiceInstance;
}
