import { Request, Response } from 'express';
import { getTxFilterService } from '../services/txFilterService';
import { sendHttpError } from '../utils/httpError';
import { parsePositiveId } from '../utils/parsePositiveId';
import {
    validateCreateTxFilterInput,
    validateUpdateTxFilterInput,
} from '../validators/txFilterValidator';

const txFilterService = getTxFilterService();

export const getTxFilters = async (_req: Request, res: Response): Promise<void> => {
    try {
        res.json(await txFilterService.getAllTxFilters());
    } catch (error) {
        sendHttpError(res, 'Error retrieving transaction filters', error);
    }
};

export const createTxFilter = async (req: Request, res: Response): Promise<void> => {
    try {
        const input = validateCreateTxFilterInput(req.body);
        const txFilter = await txFilterService.createTxFilter(input);
        res.status(201).json(txFilter);
    } catch (error) {
        sendHttpError(res, 'Error creating transaction filter', error);
    }
};

export const updateTxFilter = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = parsePositiveId(req.params.id);
    if (id === undefined) {
        res.status(400).json({ message: 'Invalid transaction filter ID' });
        return;
    }

    try {
        const input = validateUpdateTxFilterInput(req.body);
        const txFilter = await txFilterService.updateTxFilter(id, input);

        if (!txFilter) {
            res.status(404).json({ message: 'Transaction filter not found' });
            return;
        }
        res.json(txFilter);
    } catch (error) {
        sendHttpError(res, 'Error updating transaction filter', error);
    }
};

export const deleteTxFilter = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = parsePositiveId(req.params.id);
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
        sendHttpError(res, 'Error deleting transaction filter', error);
    }
};
