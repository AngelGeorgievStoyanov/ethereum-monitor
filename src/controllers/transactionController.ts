import { Request, Response } from 'express';
import { deleteStoredTransaction, listStoredTransactions } from '../services/transactionService';
import { sendHttpError } from '../utils/httpError';
import { validateTransactionIdInput, validateTransactionPaginationInput } from '../validators/transactionValidator';

export async function getAllStoredTransactions(req: Request, res: Response): Promise<void> {
    let page: number;
    let limit: number;
    try {
        ({ page, limit } = validateTransactionPaginationInput(req.query));
    } catch (error) {
        sendHttpError(res, 'Invalid transaction pagination', error);
        return;
    }

    try {
        res.json(await listStoredTransactions(page, limit));
    } catch (error) {
        sendHttpError(res, 'Error fetching transactions', error);
    }
}

export async function deleteTransactionById(
    req: Request<{ id: string }>,
    res: Response,
): Promise<void> {
    let id: number;
    try {
        id = validateTransactionIdInput(req.params.id);
    } catch (error) {
        sendHttpError(res, 'Invalid transaction ID', error);
        return;
    }

    try {
        const deleted = await deleteStoredTransaction(id);
        if (deleted === 0) {
            res.status(404).send('Transaction not found');
            return;
        }

        res.status(200).json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        sendHttpError(res, 'Error deleting transaction', error);
    }
}
