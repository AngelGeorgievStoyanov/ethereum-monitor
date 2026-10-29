import { Request, Response } from 'express';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';

import { sendHttpError } from '../utils/httpError';
import { validateScannerPauseInput } from '../validators/scannerControlValidator';
import {
    mapScannerControlResponse,
    mapScannerResumeResponse,
} from '../mappers/scannerControlMapper';
import { getScannerStatusResponse } from '../services/scannerStatusService';
import { getRescanJobStatus as loadRescanJobStatus } from '../services/scannerRescanJobService';
import { retryBlockedReorgRecovery as retryReorgRecovery } from '../services/reorgRecoveryService';
import { requestManualRescan } from '../services/manualRescanRequestService';
import { validateManualRescanFromBlock } from '../validators/manualRescanValidator';
import { getManualRescanHttpStatus, mapManualRescanResponse } from '../mappers/manualRescanMapper';

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
        const fromBlock = validateManualRescanFromBlock(req.body?.fromBlock);
        const result = await requestManualRescan(fromBlock);
        res.status(getManualRescanHttpStatus(result)).json(mapManualRescanResponse(result));
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
                message: 'Reorg recovery state changed before it could be unblocked. Refresh status and retry.',
            });
            return;
        }
        res.json(result.response);
    } catch (error) {
        sendHttpError(res, 'Unable to retry reorg recovery', error);
    }
};
