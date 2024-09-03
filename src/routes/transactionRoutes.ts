import { Router } from 'express';
import { deleteAllTransactions, getAllStoredTransactions } from '../services/transactionService';

const router = Router();

router.get('/', getAllStoredTransactions);
router.delete('/', deleteAllTransactions);

export default router;
