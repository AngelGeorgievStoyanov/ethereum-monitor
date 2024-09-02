import { ethers, TransactionReceipt, TransactionResponse } from 'ethers';
import { configInfura } from '../config/config';
import Configuration from '../models/configuration';
import async from 'async';
import { QueueObject } from 'async';

export function createEthereumService() {
    const provider = new ethers.WebSocketProvider(`wss://mainnet.infura.io/ws/v3/${configInfura.infuraProjectId}`);
    const monitoringModes = new Set<'blocks' | 'pending'>();
    const configurations = new Map<string, Configuration>();
    let transactionQueue: QueueObject<TransactionResponse>;
    let limit: any;
    let prevBlockNumber: number | undefined;
    const delaySetTimeout = 100;
    const PLIMIT = 1; // Using plimit and async to handle rate limiting due to Infura's rate limits
    const ASYNCLIMIT = 5; // Using plimit and async to handle rate limiting due to Infura's rate limits

    async function initializeLimit() {
        try {
            // Using plimit and async to handle rate limiting due to Infura's rate limits
            const pLimit = (await import('p-limit')).default;
            limit = pLimit(PLIMIT);
        } catch (error) {
            console.error('Error loading p-limit:', error);
            limit = async (fn: () => Promise<any>) => fn();
        }
    }

    async function loadConfigurations() {
        try {
            const configs = await Configuration.findAll({ where: { isActive: true } });
            configurations.clear();
            configs.forEach(config => configurations.set(config.id, config));
            await initializeMonitoringModes();
        } catch (error) {
            console.error('Error loading configurations:', error);
        }
    }

    async function initializeMonitoringModes() {
        const activeConfigurations = Array.from(configurations.values()).filter(config => config.isActive);

        if (activeConfigurations.length === 0) {
            console.error('No active configurations found.');
            stopMonitoring();
            return;
        }

        monitoringModes.clear();
        activeConfigurations.forEach(config => {
            if (config.monitoringMode === 'blocks') {
                monitoringModes.add('blocks');
            } else if (config.monitoringMode === 'pending') {
                monitoringModes.add('pending');
            }
        });

        if (monitoringModes.has('blocks')) {
            monitorBlocks();
        }
        if (monitoringModes.has('pending')) {
            monitorPendingTransactions();
        }
    }

    function monitorPendingTransactions() {
        if (monitoringModes.has('pending')) {
            provider.on('pending', async (txHash: string) => {
                try {
                    await limit(async () => {
                        const tx = await provider.getTransaction(txHash);
                        if (tx) {
                            setTimeout(() => {
                                transactionQueue.push(tx);
                            }, delaySetTimeout);
                        }
                    });
                } catch (error) {
                    console.error(`Error processing pending transaction, message: ${error.error?.message || 'An unknown error occurred'}, tx: ${txHash}`)

                }
            });
        }
    }

    function monitorBlocks() {
        if (monitoringModes.has('blocks')) {
            provider.on('block', async (blockNumber: number) => {
                if (prevBlockNumber !== blockNumber) {
                    prevBlockNumber = blockNumber;
                    try {
                        const block = await provider.getBlock(blockNumber);
                        if (block && block.transactions.length > 0) {
                            const fetchTransactions = block.transactions.map(txHash => {
                                return limit(async () => {
                                    const tx = await provider.getTransaction(txHash);
                                    if (tx) {
                                        setTimeout(() => {
                                            transactionQueue.push(tx);
                                        }, delaySetTimeout);
                                    }
                                });
                            });
                            await Promise.all(fetchTransactions);
                        }
                    } catch (error) {
                        console.error(`Error processing block ${blockNumber}:`, error.error?.message || 'An unknown error occurred');
                    }
                }
            });
        }
    }

    async function handleTransaction(tx: TransactionResponse) {
        if (!tx) return;

        let receipt: TransactionReceipt | undefined;
        try {
            receipt = await provider.getTransactionReceipt(tx.hash);
        } catch (error) {
            console.error('Error fetching transaction receipt:', error.error?.message || 'An unknown error occurred');
            return;
        }

        if (!receipt) {
            console.error(`Receipt not found for transaction ${tx.hash}`);
            return;
        }

        for (const config of configurations.values()) {
            if (config.isActive && await matchesConfiguration(tx, receipt, config)) {
                console.log(`Transaction ${tx.hash} matches configuration ${config.id}`);
            }
        }
    }


    async function matchesConfiguration(tx: ethers.TransactionResponse, receipt: ethers.TransactionReceipt, config: Configuration): Promise<boolean> {

        let isValid = true;
        // Check sender address
        if (config.senderAddress && tx.from.toLowerCase() !== config.senderAddress.toLowerCase()) {
            isValid = false;
        }

        // Check recipient address
        if (config.recipientAddress && tx.to?.toLowerCase() !== config.recipientAddress.toLowerCase()) {
            isValid = false;
        }

        // Check minimum amount
        if (config.minAmount && !isNaN(Number(config.minAmount))) {
            const txValueBigInt = BigInt(tx.value);
            const minAmountBigInt = BigInt(config.minAmount);

            if (txValueBigInt < minAmountBigInt) {

                isValid = false;
            }
        }

        // Check maximum amount
        if (config.maxAmount && !isNaN(Number(config.maxAmount))) {

            const txValueBigInt = BigInt(tx.value);
            const maxAmountBigInt = BigInt(config.maxAmount);

            if (txValueBigInt > maxAmountBigInt) {

                isValid = false;
            }
        }
        // Check exact amount
        if (config.exactAmount && !isNaN(Number(config.exactAmount))) {
            const txValueBigInt = BigInt(tx.value);
            const exactAmountBigInt = BigInt(config.exactAmount);

            if (txValueBigInt !== exactAmountBigInt) {

                isValid = false;
            }
        }


        // Check gas price 
        if (config.gasPrice) {
            const gasPriceBigInt = BigInt(config.gasPrice);
            if (tx.gasPrice < gasPriceBigInt) {
                isValid = false;
            }
        }

        // Check gas limit
        if (config.gasLimit && tx.gasLimit.toString() !== config.gasLimit) {
            isValid = false;
        }

        // Check status
        if (config.status && receipt.status !== Number(config.status)) {
            isValid = false;
        }

        // Check contract address
        if (config.contractAddress && tx.to?.toLowerCase() !== config.contractAddress.toLowerCase()) {
            isValid = false;
        }

        // Check transaction type
        if (config.transactionType && tx.type.toString() !== config.transactionType) {
            isValid = false;
        }

        // Check timestamp range
        if (config.minTimestamp || config.maxTimestamp) {
            // Fetch the block details
            const block = await this.provider.getBlock(tx.blockNumber);
            if (config.minTimestamp && block.timestamp < config.minTimestamp) {
                isValid = false;
            }
            if (config.maxTimestamp && block.timestamp > config.maxTimestamp) {
                isValid = false;
            }
        }

        // Check input data
        if (config.inputData && tx.data !== config.inputData) {
            isValid = false;
        }

        // Check access list
        if (config.accessList) {
            const txAccessList = tx.accessList ? JSON.stringify(tx.accessList) : '';
            if (JSON.stringify(config.accessList) !== txAccessList) {
                isValid = false;
            }
        }

        // Check blob versioned hashes
        if (config.blobVersionedHashes) {
            const txBlobVersionedHashes = tx.blobVersionedHashes || [];
            if (JSON.stringify(config.blobVersionedHashes) !== JSON.stringify(txBlobVersionedHashes)) {
                isValid = false;
            }
        }

        // Check transaction confirmations
        // Ensure that the transaction has received the required number of confirmations
        if (config.requiredConfirmations !== undefined) {
            const currentBlockNumber = await provider.getBlockNumber();
            const confirmations = currentBlockNumber - receipt.blockNumber;

            if (confirmations < config.requiredConfirmations) {
                isValid = false;
            }
        }

        // If all checks pass
        if (isValid) {

        }
        return isValid;
    }

    async function stopMonitoring() {
        provider.removeAllListeners();
        transactionQueue.kill();
        transactionQueue.pause();
        transactionQueue.remove(() => true);

        transactionQueue = async.queue(async (tx, callback) => {
            callback();
        }, 10);
    }

    async function addConfiguration(config: Configuration) {
        configurations.set(config.id, config);
        if (config.monitoringMode) {
            await switchMonitoringModes([config.monitoringMode]);
        }
    }

    async function updateConfiguration(config: Configuration) {
        if (config.isActive) {
            configurations.set(config.id, config);
            await initializeMonitoringModes();
        } else {
            await removeConfiguration(config.id);
        }
    }

    async function removeConfiguration(id: string) {
        if (configurations.has(id)) {
            configurations.delete(id);
        }
        const activeModes = Array.from(configurations.values())
            .map(config => config.monitoringMode)
            .filter(mode => mode) as ('blocks' | 'pending')[];
        if (activeModes.length === 0) {
            stopMonitoring();
        }
    }

    async function switchMonitoringModes(newModes: ('blocks' | 'pending')[]) {
        const newModesSet = new Set(newModes);

        if (monitoringModes.size === newModesSet.size && [...monitoringModes].every(mode => newModesSet.has(mode))) {
            return;
        }

        monitoringModes.clear();
        newModes.forEach(mode => monitoringModes.add(mode));

        if (monitoringModes.has('blocks')) {
            monitorBlocks();
        }
        if (monitoringModes.has('pending')) {
            monitorPendingTransactions();
        }
    }


    initializeLimit().then(() => {
        console.log('Initialization complete');
    }).catch(error => {
        console.error('Initialization error:', error);
    });


    // Using plimit and async to handle rate limiting due to Infura's rate limits
    transactionQueue = async.queue(async (tx, callback) => {
        try {
            await handleTransaction(tx);
        } catch (error) {
            const errorMessage = error?.error?.message || error?.message || 'An unknown error occurred';
            console.error('Error processing transaction:', errorMessage);
        } finally {
            callback();
        }
    }, ASYNCLIMIT);

    return {
        loadConfigurations,
        addConfiguration,
        updateConfiguration,
        removeConfiguration,
        getConfigurations: () => Array.from(configurations.values()),
        switchMonitoringModes
    };
}


