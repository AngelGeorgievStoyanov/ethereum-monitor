import { Router } from 'express';
import {
    createTxFilter,
    deleteTxFilter,
    getTxFilters,
    updateTxFilter,
} from './controllers/configController';
import {
    deleteTransactionById,
    getAllStoredTransactions,
} from './controllers/transactionController';

const router = Router();

router.get('/txFilters', getTxFilters);
router.post('/txFilters', createTxFilter);
router.put('/txFilters/:id', updateTxFilter);
router.delete('/txFilters/:id', deleteTxFilter);

router.get('/transactions', getAllStoredTransactions);
router.delete('/transactions/:id', deleteTransactionById);

export default router;
