import { Request, Response } from 'express';
import { deleteTransactionById as removeTransactionById, findAllTransactions } from '../repositories/transactionRepository';

export async function getAllStoredTransactions(_req: Request, res: Response): Promise<void> {
    try {
        const transactions = await findAllTransactions();
        res.json(transactions);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteTransactionById(req: Request, res: Response): Promise<void> {
    try {
        const deleted = await removeTransactionById(req.params.id);
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
