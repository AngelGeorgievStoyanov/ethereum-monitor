import { Request, Response } from 'express';
import { gettransaction filterService } from '../services/transaction filterService';

const transaction filterService = gettransaction filterService();

export const gettransaction filters = async (_req: Request, res: Response) => {
    try {
        res.json(await transaction filterService.getAlltransaction filters());
    } catch {
        res.status(500).json({ message: 'Error retrieving transaction filters' });
    }
};

export const createtransaction filter = async (req: Request, res: Response) => {
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const transaction filter = await transaction filterService.createtransaction filter({
            name,
            senderAddress: senderAddress || null,
            recipientAddress: recipientAddress || null,
            isActive: isActive ?? true,
        });

        res.status(201).json(transaction filter);
    } catch {
        res.status(500).json({ message: 'Error creating transaction filter' });
    }
};

export const updatetransaction filter = async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const transaction filter = await transaction filterService.updatetransaction filter(id, {
            ...(name !== undefined ? { name } : {}),
            ...(senderAddress !== undefined ? { senderAddress: senderAddress || null } : {}),
            ...(recipientAddress !== undefined
                ? { recipientAddress: recipientAddress || null }
                : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        });

        if (!transaction filter) {
            res.status(404).json({ message: 'transaction filter not found' });
            return;
        }

        res.json(transaction filter);
    } catch {
        res.status(500).json({ message: 'Error updating transaction filter' });
    }
};

export const deletetransaction filter = async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    try {
        const deleted = await transaction filterService.removetransaction filter(id);
        if (deleted === 0) {
            res.status(404).json({ message: 'transaction filter not found' });
            return;
        }

        res.json({ message: 'transaction filter deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting transaction filter' });
    }
};
