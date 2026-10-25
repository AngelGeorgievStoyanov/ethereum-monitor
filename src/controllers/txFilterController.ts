import { Request, Response } from 'express';
import { gettxFilterService } from '../services/txFilterService';

const txFilterService = gettxFilterService();

export const gettxFilters = async (_req: Request, res: Response) => {
    try {
        res.json(await txFilterService.getAlltxFilters());
    } catch {
        res.status(500).json({ message: 'Error retrieving transaction filters' });
    }
};

export const createtxFilter = async (req: Request, res: Response) => {
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const txFilter = await txFilterService.createtxFilter({
            name,
            senderAddress: senderAddress || null,
            recipientAddress: recipientAddress || null,
            isActive: isActive ?? true,
        });

        res.status(201).json(txFilter);
    } catch {
        res.status(500).json({ message: 'Error creating transaction filter' });
    }
};

export const updatetxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const txFilter = await txFilterService.updatetxFilter(id, {
            ...(name !== undefined ? { name } : {}),
            ...(senderAddress !== undefined ? { senderAddress: senderAddress || null } : {}),
            ...(recipientAddress !== undefined
                ? { recipientAddress: recipientAddress || null }
                : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        });

        if (!txFilter) {
            res.status(404).json({ message: 'txFilter not found' });
            return;
        }

        res.json(txFilter);
    } catch {
        res.status(500).json({ message: 'Error updating transaction filter' });
    }
};

export const deletetxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    try {
        const deleted = await txFilterService.removetxFilter(id);
        if (deleted === 0) {
            res.status(404).json({ message: 'txFilter not found' });
            return;
        }

        res.json({ message: 'txFilter deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting transaction filter' });
    }
};
