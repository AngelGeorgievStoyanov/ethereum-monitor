import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';

export interface RpcEndpoint {
    index: number;
    provider: JsonRpcProvider;
}

function loadRpcUrls(): string[] {
    return Object.entries(process.env)
        .flatMap(([name, value]) => {
            const match = /^RPC_URL_(\d+)$/.exec(name);
            return match && value?.trim()
                ? [{ index: Number(match[1]), url: value.trim() }]
                : [];
        })
        .sort((left, right) => left.index - right.index)
        .map(item => item.url);
}

export function createRpcProviderService() {
    const urls = loadRpcUrls();

    if (urls.length === 0) {
        throw new Error('No RPC endpoints configured. Add RPC_URL_1, RPC_URL_2, etc. to .env');
    }

    const endpoints: RpcEndpoint[] = urls.map((url, index) => ({
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
