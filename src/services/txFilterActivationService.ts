import { evmRpcClient } from './evmBlockDataService';

export async function getNextFilterStartBlock(): Promise<number> {
    const finalized = await evmRpcClient.getBlock('finalized');
    if (!finalized)
        throw new Error('Unable to resolve the latest finalized block for filter activation');
    return finalized.number + 1;
}
