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
import { getLiveness, getReadiness } from './controllers/healthController';
import {
    getScannerStatus,
    pauseScanner,
    resumeScannerController,
    rescanScannerController,
} from './controllers/scannerController';

const router = Router();

router.get('/health/live', getLiveness);
router.get('/health/ready', getReadiness);

router.get('/tx-filters', getTxFilters);
router.post('/tx-filters', createTxFilter);
router.put('/tx-filters/:id', updateTxFilter);
router.delete('/tx-filters/:id', deleteTxFilter);

router.get('/scanner/status', getScannerStatus);
router.post('/scanner/pause', pauseScanner);
router.post('/scanner/resume', resumeScannerController);
router.post('/scanner/rescan', rescanScannerController);

router.get('/transactions', getAllStoredTransactions);
router.delete('/transactions/:id', deleteTransactionById);

export default router;
