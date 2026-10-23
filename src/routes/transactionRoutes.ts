import { Router } from 'express';
import { deleteTransactionById, getAllStoredTransactions } from '../services/transactionService';

const router = Router();

router.get('/', getAllStoredTransactions);
router.delete('/:id', deleteTransactionById);

export default router;
