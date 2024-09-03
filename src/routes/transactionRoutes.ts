import { Router } from 'express';
import { getAllStoredTransactions } from '../services/transactionService';

const router = Router();

router.get('/', getAllStoredTransactions);


export default router;
