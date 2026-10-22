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

export function createEthereumService() {
    const provider = new ethers.JsonRpcProvider(`https://mainnet.infura.io/v3/${configInfura.infuraProjectId}`);
    const configurations = new Map<string, Configuration>();
    const scannerId = 'ethereum-mainnet';
    const pollIntervalMs = 4000;
    let scannerStarted = false;
    let stopping = false;

    const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

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
                    const location = processingBlock === undefined ? '' : ` at block ${processingBlock}`;
                    console.error(`[Ethereum scanner] Error${location}; checkpoint remains at ${state.lastProcessedBlock}:`, error instanceof Error ? error.message : error);
                }

                await wait(pollIntervalMs);
            }
        } catch (error) {
            scannerStarted = false;
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
