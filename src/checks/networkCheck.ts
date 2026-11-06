import { env } from '../config/env';
import { sendStartupRpcRequest } from './rpcRequest';

export async function runNetworkCheck(): Promise<void> {
    const results = await Promise.all(
        env.rpcEndpoints.map(async (endpoint) => {
            try {
                const response = await sendStartupRpcRequest(endpoint, 'eth_chainId', []);
                const actualChainId = BigInt(String(response));
                if (actualChainId !== env.chainId) {
                    throw new Error(
                        `chainId mismatch: expected ${env.chainId.toString()}, received ${actualChainId.toString()}`,
                    );
                }
                console.log(
                    `[NetworkCheck] ${endpoint.name} OK; chainId=${actualChainId.toString()}`,
                );
                return true;
            } catch (error) {
                console.error(
                    `[NetworkCheck] ${endpoint.name} FAILED; expected chainId=${env.chainId.toString()}; ${String(error)}`,
                );
                return false;
            }
        }),
    );
    if (results.length === 0 || results.some((result) => !result)) {
        throw new Error('Network check failed; review the RPC endpoint errors above');
    }
    console.log(
        `[NetworkCheck] All ${results.length} RPC endpoint(s) use chainId=${env.chainId.toString()}`,
    );
}
