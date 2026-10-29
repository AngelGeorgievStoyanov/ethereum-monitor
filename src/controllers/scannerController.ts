import { Request, Response } from 'express';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';

import { SCANNER_ID } from '../constants/scanner.constants';
import { sendHttpError } from '../utils/httpError';
import { validateScannerPauseInput } from '../validators/scannerControlValidator';
import {
    mapScannerControlResponse,
    mapScannerResumeResponse,
    mapReorgRecoveryRetryResponse,
} from '../mappers/scannerControlMapper';
import { getScannerStatusResponse } from '../services/scannerStatusService';
import { findScannerRescanJobById } from '../repositories/scannerRescanJobRepository';
import {
    findScannerStatusState,
    unblockScannerReorgRecovery,
} from '../repositories/scannerStateRepository';
import { requestManualRescan } from '../services/manualRescanRequestService';

export const getScannerStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        res.json(await getScannerStatusResponse());
    } catch (error) {
        sendHttpError(res, 'Unable to retrieve scanner status', error);
    }
};

export const pauseScanner = async (req: Request, res: Response): Promise<void> => {
    try {
        const input = validateScannerPauseInput(req.body);
        await requestScannerPause(input.mode, input.atBlock, input.durationMinutes);
        res.json(mapScannerControlResponse('Scanner pause requested', await getScannerControlState()));
    } catch (error) {
        sendHttpError(res, 'Unable to request scanner pause', error);
    }
};

export const resumeScannerController = async (_req: Request, res: Response): Promise<void> => {
    try {
        await resumeScanner();
        res.json(mapScannerResumeResponse(await getScannerControlState()));
    } catch (error) {
        sendHttpError(res, 'Unable to resume scanner', error);
    }
};

export const rescanScannerController = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await requestManualRescan(req.body?.fromBlock);
        res.status(result.statusCode).json(result.body);
    } catch (error) {
        sendHttpError(res, 'Unable to start manual rescan', error);
    }
};

export const getRescanJobStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const operationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const job = await findScannerRescanJobById(operationId);
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
        const state = await findScannerStatusState(SCANNER_ID);
        if (!state || !state.reorgRecoveryActive) {
            res.status(409).json({ message: 'No pending reorg recovery is available to retry.' });
            return;
        }
        if (!state.reorgRecoveryBlocked) {
            res.status(409).json({
                message: 'Reorg recovery is not blocked; no explicit retry is needed.',
            });
            return;
        }
        const unblocked = await unblockScannerReorgRecovery(SCANNER_ID);
        if (!unblocked) {
            res.status(409).json({
                message: 'Reorg recovery state changed before it could be unblocked. Refresh status and retry.',
            });
            return;
        }
        res.json(
            mapReorgRecoveryRetryResponse(state),
        );
    } catch (error) {
        sendHttpError(res, 'Unable to retry reorg recovery', error);
    }
};
