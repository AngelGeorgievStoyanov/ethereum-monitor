import { Request, Response } from 'express';
import { getTxFilterService } from '../services/txFilterService';

const txFilterService = getTxFilterService();

function parseId(value: string): number | undefined {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export const getTxFilters = async (_req: Request, res: Response) => {
    try {
        res.json(await txFilterService.getAllTxFilters());
    } catch {
        res.status(500).json({ message: 'Error retrieving transaction filters' });
    }
};

export const createTxFilter = async (req: Request, res: Response) => {
    const { description, from, to, isActive } = req.body;

    try {
        const txFilter = await txFilterService.createTxFilter({
            description,
            from: from || null,
            to: to || null,
            isActive: isActive ?? true,
        });

        res.status(201).json(txFilter);
    } catch {
        res.status(500).json({ message: 'Error creating transaction filter' });
    }
};

export const updateTxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id);
    if (id === undefined) {
        res.status(400).json({ message: 'Invalid transaction filter ID' });
        return;
    }

    const { description, from, to, isActive } = req.body;

    try {
        const txFilter = await txFilterService.updateTxFilter(id, {
            ...(description !== undefined ? { description } : {}),
            ...(from !== undefined ? { from: from || null } : {}),
            ...(to !== undefined ? { to: to || null } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        });

        if (!txFilter) {
            res.status(404).json({ message: 'Transaction filter not found' });
            return;
        }

        res.json(txFilter);
    } catch {
        res.status(500).json({ message: 'Error updating transaction filter' });
    }
};

export const deleteTxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id);
    if (id === undefined) {
        res.status(400).json({ message: 'Invalid transaction filter ID' });
        return;
    }

    try {
        const deleted = await txFilterService.removeTxFilter(id);
        if (deleted === 0) {
            res.status(404).json({ message: 'Transaction filter not found' });
            return;
        }

        res.json({ message: 'Transaction filter deleted' });
    } catch {
        res.status(500).json({ message: 'Error deleting transaction filter' });
    }
};
