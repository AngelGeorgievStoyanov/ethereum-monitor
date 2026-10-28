import { Request, Response } from 'express';
import { deleteStoredTransaction, listStoredTransactions } from '../services/transactionService';
import { sendHttpError } from '../utils/httpError';
import { parsePositiveId } from '../utils/parsePositiveId';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '../constants/transaction.constants';

function parsePositiveQueryInteger(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function getAllStoredTransactions(req: Request, res: Response): Promise<void> {
    const page =
        req.query.page === undefined ? DEFAULT_PAGE : parsePositiveQueryInteger(req.query.page);
    const limit =
        req.query.limit === undefined ? DEFAULT_LIMIT : parsePositiveQueryInteger(req.query.limit);

    if (page === undefined || limit === undefined || limit > MAX_LIMIT) {
        res.status(400).json({
            message:
                'Invalid pagination parameters. page must be a positive integer and limit must be between 1 and 100.',
        });
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
    const id = parsePositiveId(req.params.id);
    if (id === undefined) {
        res.status(400).json({ message: 'Invalid transaction ID' });
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
