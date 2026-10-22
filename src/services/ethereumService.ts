import { ethers, TransactionReceipt, TransactionResponse } from 'ethers';
import { configInfura } from '../config/config';
import Configuration from '../models/configuration';
import ScannerState from '../models/scannerState';
import { createTransactionFromEthereumData } from './transactionService';

let ethereumServiceInstance: ReturnType<typeof createEthereumService> | undefined;

export async function getReceiptForTransaction(
    provider: ethers.JsonRpcProvider,
    tx: TransactionResponse
): Promise<TransactionReceipt> {
    const receipt = await provider.getTransactionReceipt(tx.hash);
    if (!receipt) {
        throw new Error(`Receipt unavailable for transaction ${tx.hash}`);
    }
    return receipt;
}

export function matchesConfiguration(tx: TransactionResponse, config: Configuration): boolean {
    if (!config.senderAddress && !config.recipientAddress) {
        return false;
    }

    const senderMatches = !config.senderAddress
        || tx.from.toLowerCase() === config.senderAddress.toLowerCase();
    const recipientMatches = !config.recipientAddress
        || tx.to?.toLowerCase() === config.recipientAddress.toLowerCase();

    return senderMatches && recipientMatches;
}

export function getEthereumService() {
    if (!ethereumServiceInstance) {
        ethereumServiceInstance = createEthereumService();
    }
    return ethereumServiceInstance;
}

function summarizeRpcResult(method: string, result: any): string {
    if (result === null || result === undefined) {
        return String(result);
    }

    if (typeof result !== 'object') {
        return String(result);
    }

    if (method === 'eth_getBlockByNumber' || method === 'eth_getBlockByHash') {
        return JSON.stringify({
            number: result.number,
            hash: result.hash,
            transactions: Array.isArray(result.transactions) ? result.transactions.length : undefined,
        });
    }

    if (method === 'eth_getTransactionReceipt') {
        return JSON.stringify({
            transactionHash: result.transactionHash,
            blockNumber: result.blockNumber,
            status: result.status,
        });
    }

    if (method === 'eth_getTransactionByHash') {
        return JSON.stringify({
            hash: result.hash,
            blockNumber: result.blockNumber,
            from: result.from,
            to: result.to,
        });
    }

    return JSON.stringify({ type: Array.isArray(result) ? 'array' : 'object', keys: Object.keys(result).slice(0, 12) });
}

function attachInfuraRequestLogging(
    provider: ethers.JsonRpcProvider | ethers.WebSocketProvider,
    transport: 'HTTP' | 'WebSocket'
) {
    const pending = new Map<string, { method: string; startedAt: number }>();

    provider.on('debug', (event: any) => {
        const timestamp = new Date().toISOString();

        if (event.action === 'sendRpcPayload') {
            const payloads = Array.isArray(event.payload) ? event.payload : [event.payload];

            for (const payload of payloads) {
                if (!payload || payload.id === undefined) {
                    continue;
                }

                const id = String(payload.id);
                const method = String(payload.method || 'unknown');
                pending.set(id, { method, startedAt: Date.now() });
                console.log(`[Infura][${transport}][REQUEST] ${timestamp} id=${id} method=${method} params=${JSON.stringify(payload.params ?? [])}`);
            }
            return;
        }

        if (event.action === 'receiveRpcResult') {
            const responses = Array.isArray(event.result) ? event.result : [event.result];

            for (const response of responses) {
                if (!response || response.id === undefined) {
                    continue;
                }

                const id = String(response.id);
                const request = pending.get(id);
                const durationMs = request ? Date.now() - request.startedAt : undefined;
                const method = request?.method || 'unknown';
                pending.delete(id);
                console.log(`[Infura][${transport}][RESPONSE] ${timestamp} id=${id} method=${method} durationMs=${durationMs ?? 'unknown'} result=${summarizeRpcResult(method, response.result)}`);
            }
            return;
        }

        if (event.action === 'receiveRpcError') {
            const payloads = Array.isArray(event.payload) ? event.payload : [event.payload];

            for (const payload of payloads) {
                if (!payload || payload.id === undefined) {
                    continue;
                }

                const id = String(payload.id);
                const request = pending.get(id);
                const durationMs = request ? Date.now() - request.startedAt : undefined;
                const method = request?.method || payload.method || 'unknown';
                pending.delete(id);
                console.error(`[Infura][${transport}][ERROR] ${timestamp} id=${id} method=${method} durationMs=${durationMs ?? 'unknown'} error=${event.error instanceof Error ? event.error.message : JSON.stringify(event.error)}`);
            }
        }
    });
}

export function createEthereumService() {
    const provider = new ethers.JsonRpcProvider(`https://mainnet.infura.io/v3/${configInfura.infuraProjectId}`);
    attachInfuraRequestLogging(provider, 'HTTP');
    const configurations = new Map<string, Configuration>();
    const scannerId = 'ethereum-mainnet';
    const pollIntervalMs = 4000;
    const websocketRetryIntervalMs = 4000;
    const websocketWatchdogMs = 30000;
    let websocketProvider: ethers.WebSocketProvider | undefined;
    let scannerStarted = false;
    let stopping = false;

    const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

    async function closeWebSocket() {
        const current = websocketProvider;
        websocketProvider = undefined;
        if (current) {
            try {
                await current.destroy();
            } catch (error) {
                console.error('[Ethereum scanner] Error closing WebSocket:', error instanceof Error ? error.message : error);
            }
        }
    }

    async function waitForNextBlock() {
        if (stopping) {
            return;
        }

        if (!websocketProvider) {
            try {
                websocketProvider = new ethers.WebSocketProvider(configInfura.infuraWebsocketUrl);
                attachInfuraRequestLogging(websocketProvider, 'WebSocket');
                await websocketProvider.getBlockNumber();
                console.log('[Ethereum scanner] Caught up to finalized blocks. Waiting for new blocks via WebSocket.');
            } catch (error) {
                console.error('[Ethereum scanner] WebSocket connection failed; falling back to HTTP polling:', error instanceof Error ? error.message : error);
                await closeWebSocket();
                await wait(websocketRetryIntervalMs);
                return;
            }
        }

        const current = websocketProvider;
        if (!current) {
            await wait(pollIntervalMs);
            return;
        }

        const outcome = await new Promise<'block' | 'error' | 'timeout'>(resolve => {
            let settled = false;
            const timeout = setTimeout(() => finish('timeout'), websocketWatchdogMs);

            const cleanup = () => {
                clearTimeout(timeout);
                void current.removeListener('block', onBlock);
                void current.removeListener('error', onError);
            };

            const finish = (result: 'block' | 'error' | 'timeout') => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve(result);
            };

            const onBlock = (blockNumber: number) => {
                console.log(`[Infura][WebSocket][EVENT] ${new Date().toISOString()} newBlock=${blockNumber}`);
                finish('block');
            };
            const onError = () => finish('error');

            current.on('block', onBlock);
            current.on('error', onError);
        });

        if (outcome === 'block') {
            return;
        }

        console.error(`[Ethereum scanner] WebSocket ${outcome === 'timeout' ? 'received no block events before watchdog timeout' : 'reported an error'}; falling back to HTTP polling.`);
        await closeWebSocket();
        await wait(websocketRetryIntervalMs);
    }

    async function loadConfigurations() {
        const configs = await Configuration.findAll({ where: { isActive: true } });
        configurations.clear();
        configs.forEach(config => configurations.set(config.id, config));
        console.log(`[Ethereum scanner] Loaded ${configurations.size} active configuration(s)`);
        void startScanner().catch(error => {
            console.error('Unable to start Ethereum scanner:', error instanceof Error ? error.message : error);
        });
    }

    async function startScanner() {
        if (scannerStarted) {
            return;
        }
        scannerStarted = true;

        try {
            let state = await ScannerState.findByPk(scannerId);
            const rescanValue = process.env.RESCAN_FROM_BLOCK;
            const rescanBlock = rescanValue !== undefined ? Number(rescanValue) : undefined;

            if (state && rescanBlock !== undefined && Number.isSafeInteger(rescanBlock) && rescanBlock >= 0 && state.lastRescanFromBlock !== rescanBlock) {
                state.lastProcessedBlock = rescanBlock - 1;
                state.lastRescanFromBlock = rescanBlock;
                await state.save();
            }

            if (!state) {
                const configuredStart = process.env.START_BLOCK;
                const startBlock = configuredStart !== undefined ? Number(configuredStart) : undefined;
                const validRescanBlock = rescanBlock !== undefined && Number.isSafeInteger(rescanBlock) && rescanBlock >= 0;
                let initialBlock: number;

                if (validRescanBlock) {
                    initialBlock = rescanBlock;
                } else if (startBlock !== undefined && Number.isSafeInteger(startBlock) && startBlock >= 0) {
                    initialBlock = startBlock;
                } else {
                    const finalized = await provider.getBlock('finalized');
                    if (!finalized) {
                        throw new Error('Unable to resolve the latest finalized block');
                    }
                    initialBlock = finalized.number;
                }

                state = await ScannerState.create({
                    id: scannerId,
                    lastProcessedBlock: initialBlock - 1,
                    lastRescanFromBlock: validRescanBlock ? rescanBlock : null,
                });
            }

            console.log(`[Ethereum scanner] Started. Last processed block: ${state.lastProcessedBlock}`);

            while (!stopping) {
                let processingBlock: number | undefined;
                let retryAfterError = false;
                try {
                    const finalized = await provider.getBlock('finalized');
                    if (!finalized) {
                        throw new Error('Unable to resolve the latest finalized block');
                    }

                    if (configurations.size === 0) {
                        if (state.lastProcessedBlock < finalized.number) {
                            console.log(`[Ethereum scanner] No active configurations. Advancing checkpoint from ${state.lastProcessedBlock} to finalized block ${finalized.number}`);
                            state.lastProcessedBlock = finalized.number;
                            await state.save();
                        }
                    } else {
                        while (!stopping && state.lastProcessedBlock < finalized.number) {
                            const blockNumber = state.lastProcessedBlock + 1;
                            processingBlock = blockNumber;
                            const block = await provider.getBlock(blockNumber, true);

                            if (!block) {
                                throw new Error(`Unable to load block ${blockNumber}`);
                            }

                            const blockStartedAt = Date.now();
                            console.log(`[Ethereum scanner] Processing finalized block ${blockNumber} with ${block.transactions.length} transaction(s)`);
                            let matchedTransactionCount = 0;

                            for (const tx of block.prefetchedTransactions) {
                                if (!tx.to || tx.value === BigInt(0)) {
                                    continue;
                                }

                                const matchingConfigurations = Array.from(configurations.values())
                                    .filter(config => config.isActive && matchesConfiguration(tx, config));

                                if (matchingConfigurations.length === 0) {
                                    continue;
                                }

                                const receipt = await getReceiptForTransaction(provider, tx);

                                for (const config of matchingConfigurations) {
                                    await createTransactionFromEthereumData(tx, receipt, config, block.timestamp);
                                    matchedTransactionCount += 1;
                                }
                            }

                            state.lastProcessedBlock = blockNumber;
                            await state.save();
                            const blockDurationMs = Date.now() - blockStartedAt;
                            console.log(`[Ethereum scanner] Completed block ${blockNumber} in ${(blockDurationMs / 1000).toFixed(2)}s. Matched ${matchedTransactionCount} transaction/configuration pair(s). Checkpoint saved.`);
                            processingBlock = undefined;
                        }
                    }
                } catch (error) {
                    retryAfterError = true;
                    const location = processingBlock === undefined ? '' : ` at block ${processingBlock}`;
                    console.error(`[Ethereum scanner] Error${location}; checkpoint remains at ${state.lastProcessedBlock}:`, error instanceof Error ? error.message : error);
                }

                if (retryAfterError) {
                    await wait(pollIntervalMs);
                } else {
                    await waitForNextBlock();
                }
            }
        } catch (error) {
            scannerStarted = false;
            await closeWebSocket();
            throw error;
        }
    }

    async function addConfiguration(config: Configuration) {
        if (config.isActive) {
            configurations.set(config.id, config);
        }
    }

    async function updateConfiguration(config: Configuration) {
        if (config.isActive) {
            configurations.set(config.id, config);
        } else {
            configurations.delete(config.id);
        }
    }

    async function removeConfiguration(id: string) {
        configurations.delete(id);
    }

    return {
        loadConfigurations,
        addConfiguration,
        updateConfiguration,
        removeConfiguration,
        getConfigurations: () => Array.from(configurations.values()),
    };
}
