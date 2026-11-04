import { Request, Response } from 'express';
import {
    requestScannerPauseResponse,
    resumeScannerResponse,
} from '../services/scannerControlService';

import { sendHttpError } from '../utils/httpError';
import { validateScannerPauseInput } from '../validators/scannerControlValidator';
import { getScannerStatusResponse } from '../services/scannerStatusService';
import { getScannerAnalytics } from '../services/metricsAggregatorService';
import { getRescanJobStatus as loadRescanJobStatus } from '../services/scannerRescanJobService';
import { retryBlockedReorgRecovery as retryReorgRecovery } from '../services/reorgRecoveryService';
import { requestManualRescan } from '../services/manualRescanRequestService';
import { validateManualRescanFromBlock } from '../validators/manualRescanValidator';
import { getManualRescanHttpStatus } from '../mappers/manualRescanMapper';
import {
    METRICS_TIME_WINDOWS,
    DEFAULT_METRICS_WINDOW,
} from '../constants/scanner-metrics.constants';

export const getScannerStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        res.json(await getScannerStatusResponse());
    } catch (error) {
        sendHttpError(res, 'Unable to retrieve scanner status', error);
    }
};

export const getScannerAnalyticsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const requestedWindow =
            typeof req.query.window === 'string' ? req.query.window : DEFAULT_METRICS_WINDOW.value;
        const configuredWindow = METRICS_TIME_WINDOWS.find(
            (window) => window.value === requestedWindow,
        );
        const analytics = getScannerAnalytics(
            configuredWindow?.value ?? DEFAULT_METRICS_WINDOW.value,
        );
        res.json(analytics);
    } catch (error) {
        sendHttpError(res, 'Unable to retrieve scanner analytics', error);
    }
};

export const getScannerAnalysisController = async (req: Request, res: Response): Promise<void> => {
    try {
        const requestedWindow =
            typeof req.query.window === 'string' ? req.query.window : DEFAULT_METRICS_WINDOW.value;
        const configuredWindow = METRICS_TIME_WINDOWS.find(
            (window) => window.value === requestedWindow,
        );
        const analytics = getScannerAnalytics(
            configuredWindow?.value ?? DEFAULT_METRICS_WINDOW.value,
        );
        const current = analytics.current as Record<string, unknown>;
        const chain = (current.chain ?? {}) as Record<string, unknown>;
        const currentProcessing = (current.processing ?? {}) as Record<string, unknown>;
        const rpc = analytics.windowMetrics.rpc;
        const coreRpcMethods = rpc.methods.filter(
            ({ method }) =>
                method === 'getBlock(finalized)' ||
                method === 'eth_getBlockByNumber' ||
                method === 'eth_getBlockReceipts',
        );

        res.json({
            generatedAt: analytics.generatedAt,
            window: analytics.window,
            windowCoverage: analytics.windowCoverage,
            availableWindowMs: analytics.availableWindowMs,
            scanner: current.scanner,
            chain: {
                latestFinalizedBlock: chain.latestFinalizedBlock,
                lastProcessedBlock: chain.lastProcessedBlock,
                lagBlocks: chain.lagBlocks,
                rpcAvailable: chain.rpcAvailable,
                finalizedRegression: chain.finalizedRegression,
                finalizedCadence: chain.finalizedCadence,
            },
            process: current.process,
            processing: {
                ...analytics.windowMetrics.processing,
                totalBlocksSinceStart: currentProcessing.processedBlocks,
                totalTransactionsSinceStart: currentProcessing.processedTransactions,
            },
            rpc: {
                ...rpc,
                methods: coreRpcMethods,
            },
            database: analytics.windowMetrics.database,
            filters: analytics.windowMetrics.filters,
            catchUp: current.catchUp,
            recovery: current.recovery,
        });
    } catch (error) {
        sendHttpError(res, 'Unable to retrieve compact scanner analysis', error);
    }
};

export const pauseScanner = async (req: Request, res: Response): Promise<void> => {
    try {
        validateScannerPauseInput(req.body);
        res.json(await requestScannerPauseResponse());
    } catch (error) {
        sendHttpError(res, 'Unable to request scanner pause', error);
    }
};

export const resumeScannerController = async (_req: Request, res: Response): Promise<void> => {
    try {
        res.json(await resumeScannerResponse());
    } catch (error) {
        sendHttpError(res, 'Unable to resume scanner', error);
    }
};

export const rescanScannerController = async (req: Request, res: Response): Promise<void> => {
    try {
        const fromBlock = validateManualRescanFromBlock(req.body?.fromBlock);
        const result = await requestManualRescan(fromBlock);
        res.status(getManualRescanHttpStatus(result)).json(result.response);
    } catch (error) {
        sendHttpError(res, 'Unable to start manual rescan', error);
    }
};

export const getRescanJobStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const operationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const job = await loadRescanJobStatus(operationId);
        if (!job) {
            res.status(404).json({ message: 'Rescan operation not found' });
            return;
        }
        res.json(job);
    } catch (error) {
        sendHttpError(res, 'Unable to retrieve rescan status', error);
    }
};

export const retryBlockedReorgRecovery = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await retryReorgRecovery();
        if (result.kind === 'no-pending-recovery') {
            res.status(409).json({ message: 'No pending reorg recovery is available to retry.' });
            return;
        }
        if (result.kind === 'recovery-not-blocked') {
            res.status(409).json({
                message: 'Reorg recovery is not blocked; no explicit retry is needed.',
            });
            return;
        }
        if (result.kind === 'state-changed') {
            res.status(409).json({
                message:
                    'Reorg recovery state changed before it could be unblocked. Refresh status and retry.',
            });
            return;
        }
        res.json(result.response);
    } catch (error) {
        sendHttpError(res, 'Unable to retry reorg recovery', error);
    }
};
