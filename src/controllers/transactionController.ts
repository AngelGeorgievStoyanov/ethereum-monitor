import { Request, Response } from 'express';
import { deleteStoredTransaction, listStoredTransactions } from '../services/transactionService';
import { sendHttpError } from '../utils/httpError';
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
