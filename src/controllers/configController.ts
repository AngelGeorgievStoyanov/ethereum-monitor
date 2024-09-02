import { Request, Response } from 'express';
import Configuration from '../models/configuration';


export const getConfigurations = async (req: Request, res: Response) => {
    console.log('getConfigurations')
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
        res.json(configuration);
    } catch (error) {
        res.status(500).json({ message: 'Error creating configuration', error });
    }
};

export const updateConfiguration = async (req: Request, res: Response) => {
    console.log('updateConfiguration')
};

export const deleteConfiguration = async (req: Request, res: Response) => {
    console.log('deleteConfiguration')
};
