import { Request, Response } from 'express';
import Configuration from '../models/configuration';
import { getEthereumService } from '../services/ethereumService';

const ethereumService = getEthereumService();

export const getConfigurations = async (_req: Request, res: Response) => {
    try {
        const configurations = await Configuration.findAll();
        res.json(configurations);
    } catch {
        res.status(500).json({ message: 'Error retrieving configurations' });
    }
};

export const createConfiguration = async (req: Request, res: Response) => {
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const configuration = await Configuration.create({
            name,
            senderAddress: senderAddress || null,
            recipientAddress: recipientAddress || null,
            isActive: isActive ?? true,
        });

        if (configuration.isActive) {
            await ethereumService.addConfiguration(configuration);
        }

        res.status(201).json(configuration);
    } catch {
        res.status(500).json({ message: 'Error creating configuration' });
    }
};

export const updateConfiguration = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const configuration = await Configuration.findByPk(id);

        if (!configuration) {
            res.status(404).json({ message: 'Configuration not found' });
            return;
        }

        if (name !== undefined) {
            configuration.name = name;
        }
        if (senderAddress !== undefined) {
            configuration.senderAddress = senderAddress || null;
        }
        if (recipientAddress !== undefined) {
            configuration.recipientAddress = recipientAddress || null;
        }
        if (isActive !== undefined) {
            configuration.isActive = isActive;
        }

        await configuration.save();
        await ethereumService.updateConfiguration(configuration);
        res.json(configuration);
    } catch {
        res.status(500).json({ message: 'Error updating configuration' });
    }
};

export const deleteConfiguration = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const configuration = await Configuration.findByPk(id);

        if (!configuration) {
            res.status(404).json({ message: 'Configuration not found' });
            return;
        }

        await configuration.destroy();
        await ethereumService.removeConfiguration(id);
        res.json({ message: 'Configuration deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting configuration' });
    }
};
