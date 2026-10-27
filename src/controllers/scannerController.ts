import { Request, Response } from 'express';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';
import ScannerState from '../models/scannerState';
import { SCANNER_ID } from '../constants/scanner.constants';
import { HttpError, sendHttpError } from '../utils/httpError';
import { ethereumProvider } from '../services/ethereumRpcService';
import { isScannerProcessingBlocks } from '../services/blockMonitorService';
import { getTxFilterService } from '../services/txFilterService';
import { runManualRescan, RescanReorgDetectedError } from '../services/rescanService';

export const getScannerStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        const checkpoint = await ScannerState.findByPk(SCANNER_ID);
        let latestFinalizedBlock: number | null = null;
        let rpcAvailable = false;

        try {
            const finalized = await ethereumProvider.getBlock('finalized');
            if (finalized) {
                latestFinalizedBlock = finalized.number;
                rpcAvailable = true;
            }
        } catch {
            // Keep scanner status available even when the RPC providers are temporarily down.
        }

        const lastProcessedBlock = checkpoint?.lastProcessedBlock ?? null;
        res.json({
            ...getScannerControlState(),
            lastProcessedBlock,
            reorgRecoveryActive: checkpoint?.reorgRecoveryActive ?? false,
            reorgRecoveryStableBlocks: checkpoint?.reorgRecoveryStableBlocks ?? 0,
            reorgRecoveryStartBlock: checkpoint?.reorgRecoveryStartBlock ?? null,
            latestFinalizedBlock,
            lagBlocks:
                lastProcessedBlock !== null && latestFinalizedBlock !== null
                    ? latestFinalizedBlock - lastProcessedBlock
                    : null,
            rpcAvailable,
            rpcMetrics: ethereumProvider.getMetrics(),
            checkedAt: new Date().toISOString(),
        });
    } catch (error) {
        sendHttpError(res, 'Unable to retrieve scanner status', error);
    }
};

export const pauseScanner = (req: Request, res: Response): void => {
    const mode = req.body?.mode ?? 'temporary';
    const atBlock = req.body?.atBlock;
    const durationMinutes = req.body?.durationMinutes;

    if (mode !== 'manual' && mode !== 'temporary') {
        sendHttpError(
            res,
            'Invalid scanner pause mode',
            new HttpError(400, 'mode must be "manual" or "temporary"'),
        );
        return;
    }
    if (atBlock !== undefined && (!Number.isSafeInteger(atBlock) || atBlock < 0)) {
        sendHttpError(
            res,
            'Invalid scanner pause block',
            new HttpError(400, 'atBlock must be a non-negative integer'),
        );
        return;
    }
    if (
        durationMinutes !== undefined &&
        (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)
    ) {
        sendHttpError(
            res,
            'Invalid scanner pause duration',
            new HttpError(400, 'durationMinutes must be an integer between 1 and 1440'),
        );
        return;
    }

    try {
        requestScannerPause(
            mode,
            atBlock ?? null,
            mode === 'temporary' ? (durationMinutes ?? 5) : 5,
        );
        res.json({ message: 'Scanner pause requested', ...getScannerControlState() });
    } catch (error) {
        sendHttpError(res, 'Unable to request scanner pause', error);
    }
};

export const resumeScannerController = (_req: Request, res: Response): void => {
    try {
        resumeScanner();
        res.json({ message: 'Scanner resumed', ...getScannerControlState() });
    } catch (error) {
        sendHttpError(res, 'Unable to resume scanner', error);
    }
};


export const rescanScannerController = async (req: Request, res: Response): Promise<void> => {
    const fromBlock = req.body?.fromBlock;
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        res.status(400).json({ message: 'fromBlock must be a non-negative integer' });
        return;
    }

    if (!getScannerControlState().paused) {
        res.status(409).json({ message: 'Pause the scanner before starting a manual rescan.' });
        return;
    }
    if (isScannerProcessingBlocks()) {
        res.status(409).json({ message: 'The scanner is still finishing block processing. Retry the rescan after it becomes idle.' });
        return;
    }

    try {
        const state = await ScannerState.findByPk(SCANNER_ID);
        if (!state) {
            res.status(503).json({ message: 'Scanner state is not initialized' });
            return;
        }
        const result = await runManualRescan(fromBlock, state, () =>
            getTxFilterService().getTxFilters(),
        );
        res.json({ message: 'Manual rescan completed', ...result });
    } catch (error) {
        if (error instanceof RescanReorgDetectedError) {
            res.status(409).json({ message: error.message, reorgRecoveryPending: true });
            return;
        }
        sendHttpError(res, 'Manual rescan failed', error);
    }
};
