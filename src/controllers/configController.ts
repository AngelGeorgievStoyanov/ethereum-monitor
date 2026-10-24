import { Request, Response } from 'express';
import {
    createConfiguration as insertConfiguration,
    deleteConfigurationById,
    findAllConfigurations,
    updateConfiguration as persistConfiguration,
} from '../repositories/configurationRepository';
import { getConfigurationService } from '../services/configurationService';

const configurationService = getConfigurationService();

export const getConfigurations = async (_req: Request, res: Response) => {
    try {
        res.json(await findAllConfigurations());
    } catch {
        res.status(500).json({ message: 'Error retrieving configurations' });
    }
};

export const createConfiguration = async (req: Request, res: Response) => {
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const configuration = await insertConfiguration({
            name,
            senderAddress: senderAddress || null,
            recipientAddress: recipientAddress || null,
            isActive: isActive ?? true,
        });

        await configurationService.addConfiguration(configuration);
        res.status(201).json(configuration);
    } catch {
        res.status(500).json({ message: 'Error creating configuration' });
    }
};

export const updateConfiguration = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const configuration = await persistConfiguration(id, {
            ...(name !== undefined ? { name } : {}),
            ...(senderAddress !== undefined ? { senderAddress: senderAddress || null } : {}),
            ...(recipientAddress !== undefined ? { recipientAddress: recipientAddress || null } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        });

        if (!configuration) {
            res.status(404).json({ message: 'Configuration not found' });
            return;
        }

        await configurationService.updateConfiguration(configuration);
        res.json(configuration);
    } catch {
        res.status(500).json({ message: 'Error updating configuration' });
    }
};

export const deleteConfiguration = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const deleted = await deleteConfigurationById(id);
        if (deleted === 0) {
            res.status(404).json({ message: 'Configuration not found' });
            return;
        }

        await configurationService.removeConfiguration(id);
        res.json({ message: 'Configuration deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting configuration' });
    }
};
