import { Request, Response } from 'express';
import { getTxFilterService, TxFilterSyncError } from '../services/txFilterService';
import { sendHttpError } from '../utils/httpError';
import { mapTxFilterSyncFailureResponse } from '../mappers/txFilterResponseMapper';
import {
    validateCreateTxFilterInput,
    validateUpdateTxFilterInput,
    validateTxFilterIdInput,
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
        if (error instanceof TxFilterSyncError) {
            res.status(202).json(mapTxFilterSyncFailureResponse('created', error.result));
            return;
        }
        sendHttpError(res, 'Error creating transaction filter', error);
    }
};

export const updateTxFilter = async (
    req: Request<{ id: string }>,
    res: Response,
): Promise<void> => {
    let id: number;
    try {
        id = validateTxFilterIdInput(req.params.id);
    } catch (error) {
        sendHttpError(res, 'Invalid transaction filter ID', error);
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
        if (error instanceof TxFilterSyncError) {
            res.status(202).json(mapTxFilterSyncFailureResponse('updated', error.result));
            return;
        }
        sendHttpError(res, 'Error updating transaction filter', error);
    }
};

export const deleteTxFilter = async (
    req: Request<{ id: string }>,
    res: Response,
): Promise<void> => {
    let id: number;
    try {
        id = validateTxFilterIdInput(req.params.id);
    } catch (error) {
        sendHttpError(res, 'Invalid transaction filter ID', error);
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
        if (error instanceof TxFilterSyncError) {
            res.status(202).json(mapTxFilterSyncFailureResponse('deleted', error.result));
            return;
        }
        sendHttpError(res, 'Error deleting transaction filter', error);
    }
};
