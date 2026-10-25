import { Request, Response } from 'express';
import { getTxFilterService } from '../services/txFilterService';

const txFilterService = getTxFilterService();

export const getTxFilters = async (_req: Request, res: Response) => {
    try {
        res.json(await txFilterService.getAllTxFilters());
    } catch {
        res.status(500).json({ message: 'Error retrieving txFilters' });
    }
};

export const createTxFilter = async (req: Request, res: Response) => {
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const txFilter = await txFilterService.createTxFilter({
            name,
            senderAddress: senderAddress || null,
            recipientAddress: recipientAddress || null,
            isActive: isActive ?? true,
        });

        res.status(201).json(txFilter);
    } catch {
        res.status(500).json({ message: 'Error creating txFilter' });
    }
};

export const updateTxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const { name, senderAddress, recipientAddress, isActive } = req.body;

    try {
        const txFilter = await txFilterService.updateTxFilter(id, {
            ...(name !== undefined ? { name } : {}),
            ...(senderAddress !== undefined ? { senderAddress: senderAddress || null } : {}),
            ...(recipientAddress !== undefined
                ? { recipientAddress: recipientAddress || null }
                : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        });

        if (!txFilter) {
            res.status(404).json({ message: 'TxFilter not found' });
            return;
        }

        res.json(txFilter);
    } catch {
        res.status(500).json({ message: 'Error updating txFilter' });
    }
};

export const deleteTxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    try {
        const deleted = await txFilterService.removeTxFilter(id);
        if (deleted === 0) {
            res.status(404).json({ message: 'TxFilter not found' });
            return;
        }

        res.json({ message: 'TxFilter deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting txFilter' });
    }
};
