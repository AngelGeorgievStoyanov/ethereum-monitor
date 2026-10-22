import { ethers, TransactionReceipt, TransactionResponse } from 'ethers';
import { configInfura } from '../config/config';
import Configuration from '../models/configuration';
import ScannerState from '../models/scannerState';
import { createTransactionFromEthereumData } from './transactionService';

let ethereumServiceInstance: ReturnType<typeof createEthereumService> | undefined;

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
        await startScanner();
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
                let initialBlock: number;

                if (startBlock !== undefined && Number.isSafeInteger(startBlock) && startBlock >= 0) {
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
                    lastRescanFromBlock: rescanBlock !== undefined && Number.isSafeInteger(rescanBlock) && rescanBlock >= 0 ? rescanBlock : null,
                });
            }

            while (!stopping) {
                try {
                    const finalized = await provider.getBlock('finalized');
                    if (!finalized) {
                        throw new Error('Unable to resolve the latest finalized block');
                    }

                    if (configurations.size === 0) {
                        if (state.lastProcessedBlock < finalized.number) {
                            state.lastProcessedBlock = finalized.number;
                            await state.save();
                        }
                    } else {
                        while (!stopping && state.lastProcessedBlock < finalized.number) {
                            const blockNumber = state.lastProcessedBlock + 1;
                            const block = await provider.getBlock(blockNumber);

                            if (!block) {
                                throw new Error(`Unable to load block ${blockNumber}`);
                            }

                            for (const transactionHash of block.transactions) {
                                const tx = await provider.getTransaction(transactionHash);
                                if (!tx || !tx.to) {
                                    continue;
                                }

                                const receipt = await provider.getTransactionReceipt(tx.hash);
                                if (!receipt) {
                                    throw new Error(`Receipt unavailable for transaction ${tx.hash}`);
                                }

                                for (const config of configurations.values()) {
                                    if (config.isActive && matchesConfiguration(tx, config)) {
                                        await createTransactionFromEthereumData(tx, receipt, config, block.timestamp);
                                    }
                                }
                            }

                            state.lastProcessedBlock = blockNumber;
                            await state.save();
                        }
                    }
                } catch (error) {
                    console.error('Ethereum scanner error:', error instanceof Error ? error.message : error);
                }

                await wait(pollIntervalMs);
            }
        } catch (error) {
            scannerStarted = false;
            throw error;
        }
    }

    function matchesConfiguration(tx: TransactionResponse, config: Configuration): boolean {
        if (config.senderAddress && tx.from.toLowerCase() !== config.senderAddress.toLowerCase()) {
            return false;
        }

        if (config.recipientAddress && tx.to?.toLowerCase() !== config.recipientAddress.toLowerCase()) {
            return false;
        }

        return true;
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
