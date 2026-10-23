import { ethers, TransactionResponse } from 'ethers';
import { configInfura } from '../config/config';
import Configuration from '../models/configuration';
import ScannerState from '../models/scannerState';
import { createTransactionFromEthereumData } from './transactionService';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)').toLowerCase();
const MAX_BLOCK_FETCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 15000;

let ethereumServiceInstance: ReturnType<typeof createEthereumService> | undefined;

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
            const message = event.error instanceof Error ? event.error.message : JSON.stringify(event.error);

            if (pending.size === 0) {
                console.error(`[Infura][${transport}][ERROR] ${timestamp} id=unknown method=unknown durationMs=unknown error=${message}`);
                return;
            }

            for (const [id, request] of pending.entries()) {
                const durationMs = Date.now() - request.startedAt;
                console.error(`[Infura][${transport}][ERROR] ${timestamp} id=${id} method=${request.method} durationMs=${durationMs} error=${message}`);
                pending.delete(id);
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

    async function fetchBlockDataWithRetry(blockNumber: number) {
        for (let attempt = 1; attempt <= MAX_BLOCK_FETCH_ATTEMPTS; attempt += 1) {
            const attemptStartedAt = Date.now();
            console.log(`[Ethereum scanner][BLOCK_FETCH][START] block=${blockNumber} attempt=${attempt}/${MAX_BLOCK_FETCH_ATTEMPTS}`);
            try {
                const [block, receipts] = await Promise.all([
                    (async () => {
                        const startedAt = Date.now();
                        try {
                            const result = await provider.getBlock(blockNumber, true);
                            console.log(`[Ethereum scanner][RPC][COMPLETE] method=eth_getBlockByNumber block=${blockNumber} durationMs=${Date.now()-startedAt} success=${Boolean(result)}`);
                            return result;
                        } catch (error) {
                            console.error(`[Ethereum scanner][RPC][ERROR] method=eth_getBlockByNumber block=${blockNumber} durationMs=${Date.now()-startedAt} error=${error instanceof Error ? error.message : String(error)}`);
                            throw error;
                        }
                    })(),
                    (async () => {
                        const startedAt = Date.now();
                        try {
                            const result = await provider.send('eth_getBlockReceipts', [ethers.toQuantity(blockNumber)]);
                            if (!Array.isArray(result)) throw new Error('eth_getBlockReceipts returned a non-array response');
                            console.log(`[Ethereum scanner][RPC][COMPLETE] method=eth_getBlockReceipts block=${blockNumber} durationMs=${Date.now()-startedAt} receiptCount=${result.length} success=true`);
                            return result;
                        } catch (error) {
                            console.error(`[Ethereum scanner][RPC][ERROR] method=eth_getBlockReceipts block=${blockNumber} durationMs=${Date.now()-startedAt} error=${error instanceof Error ? error.message : String(error)}`);
                            throw error;
                        }
                    })(),
                ]);
                if (!block) throw new Error(`Unable to load block ${blockNumber}`);
                console.log(`[Ethereum scanner][BLOCK_FETCH][COMPLETE] block=${blockNumber} attempt=${attempt} durationMs=${Date.now()-attemptStartedAt} transactions=${block.transactions.length} receipts=${receipts.length}`);
                return { block, receipts };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (attempt === MAX_BLOCK_FETCH_ATTEMPTS) {
                    console.error(`[Ethereum scanner][BLOCK_FETCH][FAILED] block=${blockNumber} attempts=${attempt} durationMs=${Date.now()-attemptStartedAt} error=${message}`);
                    throw error;
                }
                const delayMs = Math.min(RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)), RETRY_MAX_DELAY_MS);
                console.error(`[Ethereum scanner][BLOCK_FETCH][RETRY] block=${blockNumber} failedAttempt=${attempt} retryInMs=${delayMs} error=${message}`);
                await wait(delayMs);
            }
        }
        throw new Error(`Unable to fetch block data for block ${blockNumber}`);
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
                        const catchupStartedAt = Date.now();
                        const catchupStartBlock = state.lastProcessedBlock + 1;
                        let catchupProcessedBlocks = 0;
                        while (!stopping && state.lastProcessedBlock < finalized.number) {
                            const blockNumber = state.lastProcessedBlock + 1;
                            processingBlock = blockNumber;
                            const blockStartedAt = Date.now();
                            const { block, receipts } = await fetchBlockDataWithRetry(blockNumber);
                            const blockTimestamp = block.timestamp;
                            const receiptsByHash = new Map<string, any>(receipts.map((r: any) => [String(r.transactionHash).toLowerCase(), r]));
                            const transactionsByHash = new Map<string, TransactionResponse>(block.prefetchedTransactions.map(tx => [tx.hash.toLowerCase(), tx]));
                            console.log(`[Ethereum scanner][BLOCK][START] block=${blockNumber} transactions=${block.transactions.length} receipts=${receipts.length} checkpoint=${state.lastProcessedBlock}`);
                            let nativeTransfersSeen = 0;
                            let nativeMatchedCount = 0;
                            let erc20TransferLogsSeen = 0;
                            let erc20MatchedCount = 0;
                            let databaseWriteDurationMs = 0;

                            for (const tx of block.prefetchedTransactions) {
                                if (!tx.to || tx.value <= 0n) continue;
                                nativeTransfersSeen += 1;
                                const matchingConfigurations = Array.from(configurations.values()).filter(config => config.isActive && matchesConfiguration(tx, config));
                                if (matchingConfigurations.length === 0) continue;
                                const receipt = receiptsByHash.get(tx.hash.toLowerCase());
                                if (!receipt) throw new Error(`Block receipts did not contain native transaction ${tx.hash} in block ${blockNumber}`);
                                for (const config of matchingConfigurations) {
                                    const writeStartedAt = Date.now();
                                    await createTransactionFromEthereumData(tx, receipt, config, blockTimestamp, { transferType: 'native', logIndex: -1, from: tx.from, to: tx.to, value: tx.value.toString() });
                                    databaseWriteDurationMs += Date.now() - writeStartedAt;
                                    nativeMatchedCount += 1;
                                }
                            }

                            for (const receipt of receipts) {
                                if (Number(BigInt(receipt.status ?? '0x0')) !== 1) continue;
                                const txHash = String(receipt.transactionHash).toLowerCase();
                                const tx = transactionsByHash.get(txHash);
                                if (!tx) throw new Error(`Block transaction ${receipt.transactionHash} was not found in block ${blockNumber}`);
                                for (const log of receipt.logs ?? []) {
                                    if (!Array.isArray(log.topics) || log.topics.length !== 3 || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC || !/^0x[0-9a-fA-F]{40}$/.test(String(log.address))) continue;
                                    erc20TransferLogsSeen += 1;
                                    const from = ethers.getAddress(`0x${String(log.topics[1]).slice(-40)}`);
                                    const to = ethers.getAddress(`0x${String(log.topics[2]).slice(-40)}`);
                                    const value = BigInt(log.data).toString();
                                    const logIndex = Number(BigInt(log.logIndex));
                                    const matchingConfigurations = Array.from(configurations.values()).filter(config =>
                                        config.isActive && (config.senderAddress || config.recipientAddress)
                                        && (!config.senderAddress || from.toLowerCase() === config.senderAddress.toLowerCase())
                                        && (!config.recipientAddress || to.toLowerCase() === config.recipientAddress.toLowerCase()));
                                    for (const config of matchingConfigurations) {
                                        const writeStartedAt = Date.now();
                                        await createTransactionFromEthereumData(tx, receipt, config, blockTimestamp, { transferType: 'erc20', tokenAddress: ethers.getAddress(log.address), logIndex, from, to, value });
                                        databaseWriteDurationMs += Date.now() - writeStartedAt;
                                        erc20MatchedCount += 1;
                                    }
                                }
                            }

                            state.lastProcessedBlock = blockNumber;
                            await state.save();
                            const blockDurationMs = Date.now() - blockStartedAt;
                            const matchedTotal = nativeMatchedCount + erc20MatchedCount;
                            const blocksPerSecond = blockDurationMs > 0 ? (1000 / blockDurationMs).toFixed(3) : 'n/a';
                            console.log(`[Ethereum scanner][BLOCK][COMPLETE] block=${blockNumber} durationMs=${blockDurationMs} blocksPerSecond=${blocksPerSecond} nativeTransfersSeen=${nativeTransfersSeen} nativeMatched=${nativeMatchedCount} erc20TransferLogsSeen=${erc20TransferLogsSeen} erc20Matched=${erc20MatchedCount} matchedTotal=${matchedTotal} databaseWriteDurationMs=${databaseWriteDurationMs} checkpoint=${state.lastProcessedBlock}`);
                            processingBlock = undefined;
                            catchupProcessedBlocks += 1;
                        }
                        if (catchupProcessedBlocks > 0) {
                            const catchupDurationMs = Date.now() - catchupStartedAt;
                            const catchupBlocksPerSecond = catchupDurationMs > 0 ? (catchupProcessedBlocks * 1000 / catchupDurationMs).toFixed(3) : 'n/a';
                            console.log(`[Ethereum scanner][CATCH_UP][COMPLETE] fromBlock=${catchupStartBlock} toBlock=${state.lastProcessedBlock} blocks=${catchupProcessedBlocks} durationMs=${catchupDurationMs} blocksPerSecond=${catchupBlocksPerSecond} checkpoint=${state.lastProcessedBlock}`);
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
