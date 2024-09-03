import { Request, Response } from 'express';
import Configuration from '../models/configuration';
import { getEthereumService } from '../services/ethereumService';


const ethereumService = getEthereumService();


export const getConfigurations = async (req: Request, res: Response) => {
    try {
        const configurations = await Configuration.findAll();
        res.json(configurations);
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving configurations', error });
    }
};

export const createConfiguration = async (req: Request, res: Response) => {
    const {
        name, senderAddress, recipientAddress, minAmount, maxAmount, exactAmount, eventType, blockNumber,
        gasPrice, gasLimit, status, contractAddress, maxFeePerGas, maxPriorityFeePerGas,
        gas, nonce, value, transactionType, minTimestamp, maxTimestamp, inputData,
        accessList, blobVersionedHashes, isActive, monitoringMode, requiredConfirmations
    } = req.body;

    try {
        const configuration = await Configuration.create({
            name, senderAddress, recipientAddress, minAmount, maxAmount, exactAmount, eventType, blockNumber,
            gasPrice, gasLimit, status, contractAddress, maxFeePerGas, maxPriorityFeePerGas,
            gas, nonce, value, transactionType, minTimestamp, maxTimestamp, inputData,
            accessList, blobVersionedHashes, isActive, monitoringMode, requiredConfirmations
        });
        if (configuration.isActive) {
            await ethereumService.addConfiguration(configuration);
        }
        res.json(configuration);
    } catch (error) {
        res.status(500).json({ message: 'Error creating configuration', error });
    }
};

export const updateConfiguration = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        name, senderAddress, recipientAddress, minAmount, maxAmount, exactAmount, eventType, blockNumber,
        gasPrice, gasLimit, status, contractAddress, maxFeePerGas, maxPriorityFeePerGas,
        gas, nonce, value, transactionType, minTimestamp, maxTimestamp, inputData,
        accessList, blobVersionedHashes, isActive, monitoringMode, requiredConfirmations
    } = req.body;

    try {
        const configuration = await Configuration.findByPk(id);

        if (!configuration) {
            return res.status(404).json({ message: 'Configuration not found' });
        }

        configuration.name = name ?? configuration.name;
        configuration.senderAddress = senderAddress ?? configuration.senderAddress;
        configuration.recipientAddress = recipientAddress ?? configuration.recipientAddress;
        configuration.minAmount = minAmount ?? configuration.minAmount;
        configuration.maxAmount = maxAmount ?? configuration.maxAmount;
        configuration.exactAmount = exactAmount ?? configuration.exactAmount;
        configuration.eventType = eventType ?? configuration.eventType;
        configuration.blockNumber = blockNumber ?? configuration.blockNumber;
        configuration.gasPrice = gasPrice ?? configuration.gasPrice;
        configuration.gasLimit = gasLimit ?? configuration.gasLimit;
        configuration.status = status ?? configuration.status;
        configuration.contractAddress = contractAddress ?? configuration.contractAddress;
        configuration.maxFeePerGas = maxFeePerGas ?? configuration.maxFeePerGas;
        configuration.maxPriorityFeePerGas = maxPriorityFeePerGas ?? configuration.maxPriorityFeePerGas;
        configuration.gas = gas ?? configuration.gas;
        configuration.nonce = nonce ?? configuration.nonce;
        configuration.value = value ?? configuration.value;
        configuration.transactionType = transactionType ?? configuration.transactionType;
        configuration.minTimestamp = minTimestamp ?? configuration.minTimestamp;
        configuration.maxTimestamp = maxTimestamp ?? configuration.maxTimestamp;
        configuration.inputData = inputData ?? configuration.inputData;
        configuration.accessList = accessList ?? configuration.accessList;
        configuration.blobVersionedHashes = blobVersionedHashes ?? configuration.blobVersionedHashes;
        configuration.isActive = isActive ?? configuration.isActive;
        configuration.monitoringMode = monitoringMode ?? configuration.monitoringMode;
        configuration.requiredConfirmations = requiredConfirmations ?? configuration.requiredConfirmations;

        await configuration.save();
       
        await ethereumService.updateConfiguration(configuration);

        res.json(configuration);
    } catch (error) {
        res.status(500).json({ message: 'Error updating configuration', error });
    }
};

export const deleteConfiguration = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const configuration = await Configuration.findByPk(id);

        if (!configuration) {
            return res.status(404).json({ message: 'Configuration not found' });
        }

        await configuration.destroy();
        if (configuration.isActive) {
            await ethereumService.removeConfiguration(id);
        }

        res.json({ message: 'Configuration deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting configuration', error });
    }
};
