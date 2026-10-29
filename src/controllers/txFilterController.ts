import { Request, Response } from 'express';
import { getTxFilterService, TxFilterSyncError } from '../services/txFilterService';
import { sendHttpError } from '../utils/httpError';
import { TX_FILTER_RELOAD_RETRY_DELAYS_MS } from '../constants/tx-filter.constants';
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
            res.status(202).json({
                message: `Filter saved to the database, but the scanner is still using its previous filters. Reload failed after ${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1} attempts.`,
                scannerSync: 'out_of_sync',
                data: error.result,
            });
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
            res.status(202).json({
                message: `Filter changes were saved to the database, but the scanner is still using its previous filters. Reload failed after ${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1} attempts.`,
                scannerSync: 'out_of_sync',
                data: error.result,
            });
            return;
        }
        sendHttpError(res, 'Error updating transaction filter', error);
    }
};

export const deleteTxFilter = async (
    req: Request<{ id: string }>,
    res: Response,
): Promise<void> => {
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
        if (error instanceof TxFilterSyncError) {
            res.status(202).json({
                message: `Filter was deleted from the database, but the scanner is still using its previous filters. Reload failed after ${TX_FILTER_RELOAD_RETRY_DELAYS_MS.length + 1} attempts.`,
                scannerSync: 'out_of_sync',
                data: error.result,
            });
            return;
        }
        sendHttpError(res, 'Error deleting transaction filter', error);
    }
};
