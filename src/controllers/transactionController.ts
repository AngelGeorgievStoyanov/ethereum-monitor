import { Request, Response } from 'express';
import { deleteStoredTransaction, listStoredTransactions } from '../services/transactionService';
import { HttpError, sendHttpError } from '../utils/httpError';
import { parsePositiveId } from '../utils/parsePositiveId';

export async function getAllStoredTransactions(_req: Request, res: Response): Promise<void> {
    try {
        res.json(await listStoredTransactions());
    } catch (error) {
        sendHttpError(res, 'Error fetching transactions', error);
    }
}

export async function deleteTransactionById(
    req: Request<{ id: string }>,
    res: Response,
): Promise<void> {
    const id = parsePositiveId(req.params.id);
    if (id === undefined) {
        sendHttpError(res, 'Invalid transaction ID', new HttpError(400, 'Invalid transaction ID'));
        return;
    }

    try {
        const deleted = await deleteStoredTransaction(id);
        if (deleted === 0) {
            sendHttpError(
                res,
                'Transaction not found',
                new HttpError(404, 'Transaction not found'),
            );
            return;
        }

        res.status(200).json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        sendHttpError(res, 'Error deleting transaction', error);
    }
}
