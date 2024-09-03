import { Router } from 'express';
import { deleteAllTransactions, deleteTransactionById, deleteTransactionsWithQuery, getAllStoredTransactions, getTransactionsWithQuery } from '../services/transactionService';

const router = Router();

router.get('/', getAllStoredTransactions);
router.delete('/', deleteAllTransactions);
router.delete('/filter', deleteTransactionsWithQuery);
router.delete('/:id', deleteTransactionById);
router.get('/filter/query', getTransactionsWithQuery);
export default router;
