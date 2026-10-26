import { Request, Response } from 'express';
import { getTxFilterService } from '../services/txFilterService';

const txFilterService = getTxFilterService();

function parseId(value: string): number | undefined {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function sendError(res: Response, message: string, error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    const status = /unsupported|requires|invalid|must have|must contain|only supported|every filter group/i.test(details)
        ? 400
        : 500;
    res.status(status).json({ message, details });
}

export const getTxFilters = async (_req: Request, res: Response) => {
    try {
        res.json(await txFilterService.getAllTxFilters());
    } catch (error) {
        sendError(res, 'Error retrieving transaction filters', error);
    }
};

export const createTxFilter = async (req: Request, res: Response) => {
    const { description, from, to, isActive, rule } = req.body ?? {};
    if (typeof description !== 'string' || description.trim().length === 0) {
        res.status(400).json({ message: 'A filter description is required' });
        return;
    }

    try {
        const txFilter = await txFilterService.createTxFilter({
            description: description.trim(),
            from: from || null,
            to: to || null,
            isActive: isActive ?? true,
            ...(rule !== undefined ? { rule } : {}),
        });
        res.status(201).json(txFilter);
    } catch (error) {
        sendError(res, 'Error creating transaction filter', error);
    }
};

export const updateTxFilter = async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id);
    if (id === undefined) {
        res.status(400).json({ message: 'Invalid transaction filter ID' });
        return;
    }

    const { description, from, to, isActive, rule } = req.body ?? {};
    if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
        res.status(400).json({ message: 'Filter description must be a non-empty string' });
        return;
    }

    try {
        const txFilter = await txFilterService.updateTxFilter(id, {
            ...(description !== undefined ? { description: description.trim() } : {}),
            ...(from !== undefined ? { from: from || null } : {}),
            ...(to !== undefined ? { to: to || null } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
            ...(rule !== undefined ? { rule } : {}),
        });

        if (!txFilter) {
            res.status(404).json({ message: 'Transaction filter not found' });
            return;
        }
        res.json(txFilter);
    } catch (error) {
        sendError(res, 'Error updating transaction filter', error);
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
    } catch (error) {
        sendError(res, 'Error deleting transaction filter', error);
    }
};
