import { Router } from 'express';
import {
    createConfiguration,
    deleteConfiguration,
    getConfigurations,
    updateConfiguration,
} from './controllers/configController';
import {
    deleteTransactionById,
    getAllStoredTransactions,
} from './controllers/transactionController';

const router = Router();

router.get('/configurations', getConfigurations);
router.post('/configurations', createConfiguration);
router.put('/configurations/:id', updateConfiguration);
router.delete('/configurations/:id', deleteConfiguration);

router.get('/transactions', getAllStoredTransactions);
router.delete('/transactions/:id', deleteTransactionById);

export default router;
