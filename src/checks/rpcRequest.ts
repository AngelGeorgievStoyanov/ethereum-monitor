import { RPC_ENDPOINT_TIMEOUT_MS } from '../constants/evm-rpc.constants';

export interface RpcEndpointConfig {
    name: string;
    url: string;
}

interface JsonRpcResponse {
    result?: unknown;
    error?: { code?: number; message?: string };
}

export async function sendStartupRpcRequest(
    endpoint: RpcEndpointConfig,
    method: string,
    params: unknown[],
): Promise<unknown> {
    const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_ENDPOINT_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as JsonRpcResponse;
    if (payload.error) {
        throw new Error(
            `JSON-RPC ${payload.error.code ?? 'error'}: ${payload.error.message ?? 'Unknown RPC error'}`,
        );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
        throw new Error('RPC response does not contain a result');
    }
    return payload.result;
}
