import { Router } from 'express';
import {
    createTxFilter,
    deleteTxFilter,
    getTxFilters,
    updateTxFilter,
} from './controllers/txFilterController';
import {
    deleteTransactionById,
    getAllStoredTransactions,
} from './controllers/transactionController';

const router = Router();

router.get('/tx-filters', getTxFilters);
router.post('/tx-filters', createTxFilter);
router.put('/tx-filters/:id', updateTxFilter);
router.delete('/tx-filters/:id', deleteTxFilter);

router.get('/transactions', getAllStoredTransactions);
router.delete('/transactions/:id', deleteTransactionById);

export default router;
