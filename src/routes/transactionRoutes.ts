import { Router } from 'express';
import { deleteAllTransactions, deleteTransactionById, deleteTransactionsWithQuery, getAllStoredTransactions } from '../services/transactionService';

const router = Router();

router.get('/', getAllStoredTransactions);
router.delete('/', deleteAllTransactions);
router.delete('/filter', deleteTransactionsWithQuery); 
router.delete('/:id', deleteTransactionById);
export default router;
