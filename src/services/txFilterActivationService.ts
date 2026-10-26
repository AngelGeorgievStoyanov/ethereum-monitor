import { ethereumProvider } from './ethereumRpcService';

export async function getNextFilterStartBlock(): Promise<number> {
    const finalized = await ethereumProvider.getBlock('finalized');
    if (!finalized)
        throw new Error('Unable to resolve the latest finalized block for filter activation');
    return finalized.number + 1;
}
