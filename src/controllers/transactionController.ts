import { Request, Response } from 'express';
import { deleteStoredTransaction, listStoredTransactions } from '../services/transactionService';

function parseId(value: string): number | undefined {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export async function getAllStoredTransactions(_req: Request, res: Response): Promise<void> {
    try {
        const transactions = await listStoredTransactions();
        res.json(transactions);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteTransactionById(
    req: Request<{ id: string }>,
    res: Response,
): Promise<void> {
    const id = parseId(req.params.id);
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
        console.error('Error deleting transaction:', error);
        res.status(500).send('Internal Server Error');
    }
}
