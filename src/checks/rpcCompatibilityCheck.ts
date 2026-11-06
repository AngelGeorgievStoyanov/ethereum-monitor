import { env } from '../config/env';
import { sendStartupRpcRequest } from './rpcRequest';

interface FinalizedBlockResponse {
    number?: string;
}

export async function runRpcCompatibilityCheck(): Promise<void> {
    const results = await Promise.all(
        env.rpcEndpoints.map(async (endpoint) => {
            let finalizedBlockNumber: string | undefined;
            let compatible = true;
            try {
                const finalizedResponse = await sendStartupRpcRequest(
                    endpoint,
                    'eth_getBlockByNumber',
                    ['finalized', false],
                );
                const response = finalizedResponse as FinalizedBlockResponse | null;
                if (!response || typeof response.number !== 'string') {
                    throw new Error('finalized block response is empty or has no block number');
                }
                finalizedBlockNumber = response.number;
                console.log(`[RPCCompatibilityCheck] ${endpoint.name} finalized: OK`);
            } catch (error) {
                compatible = false;
                console.error(
                    `[RPCCompatibilityCheck] ${endpoint.name} finalized: UNSUPPORTED/FAILED; ${String(error)}`,
                );
            }
            if (finalizedBlockNumber) {
                try {
                    const receipts = await sendStartupRpcRequest(endpoint, 'eth_getBlockReceipts', [
                        finalizedBlockNumber,
                    ]);
                    if (!Array.isArray(receipts)) {
                        throw new Error('eth_getBlockReceipts returned a non-array response');
                    }
                    console.log(
                        `[RPCCompatibilityCheck] ${endpoint.name} eth_getBlockReceipts: OK`,
                    );
                } catch (error) {
                    compatible = false;
                    console.error(
                        `[RPCCompatibilityCheck] ${endpoint.name} eth_getBlockReceipts: UNSUPPORTED/FAILED; ${String(error)}`,
                    );
                }
            } else {
                console.error(
                    `[RPCCompatibilityCheck] ${endpoint.name} eth_getBlockReceipts: NOT CHECKED because finalized is unavailable`,
                );
            }
            return compatible;
        }),
    );
    if (results.length === 0 || results.some((result) => !result)) {
        throw new Error(
            'RPC compatibility check failed; every configured endpoint must support finalized and eth_getBlockReceipts',
        );
    }
    console.log(
        `[RPCCompatibilityCheck] All ${results.length} RPC endpoint(s) support required methods`,
    );
}
