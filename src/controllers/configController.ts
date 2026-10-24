import { Request, Response } from 'express';
import { getConfigurationService } from '../services/configurationService';

const configurationService = getConfigurationService();

export const getConfigurations = async (_req: Request, res: Response) => {
    try {
        res.json(await configurationService.getAllConfigurations());
    } catch {
        res.status(500).json({ message: 'Error retrieving configurations' });
    }
};

export const createConfiguration = async (req: Request, res: Response) => {
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const configuration = await configurationService.createConfiguration({
            name,
            senderAddress: senderAddress || null,
            recipientAddress: recipientAddress || null,
            isActive: isActive ?? true,
        });

        res.status(201).json(configuration);
    } catch {
        res.status(500).json({ message: 'Error creating configuration' });
    }
};

export const updateConfiguration = async (
    req: Request<{ id: string }>,
    res: Response,
) => {
    const { id } = req.params;
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const configuration = await configurationService.updateConfiguration(id, {
            ...(name !== undefined ? { name } : {}),
            ...(senderAddress !== undefined ? { senderAddress: senderAddress || null } : {}),
            ...(recipientAddress !== undefined
                ? { recipientAddress: recipientAddress || null }
                : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        });

        if (!configuration) {
            res.status(404).json({ message: 'Configuration not found' });
            return;
        }

        res.json(configuration);
    } catch {
        res.status(500).json({ message: 'Error updating configuration' });
    }
};

export const deleteConfiguration = async (
    req: Request<{ id: string }>,
    res: Response,
) => {
    const { id } = req.params;

    try {
        const deleted = await configurationService.removeConfiguration(id);
        if (deleted === 0) {
            res.status(404).json({ message: 'Configuration not found' });
            return;
        }

        res.json({ message: 'Configuration deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting configuration' });
    }
};
