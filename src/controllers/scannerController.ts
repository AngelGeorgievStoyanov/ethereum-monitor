import { Request, Response } from 'express';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';

import {
    SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
    SCANNER_ID,
    SCANNER_MAX_PAUSE_DURATION_MINUTES,
} from '../constants/scanner.constants';
import { HttpError, sendHttpError } from '../utils/httpError';
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
        (!Number.isSafeInteger(durationMinutes) ||
            durationMinutes < 1 ||
            durationMinutes > SCANNER_MAX_PAUSE_DURATION_MINUTES)
    ) {
        sendHttpError(
            res,
            'Invalid scanner pause duration',
            new HttpError(
                400,
                `durationMinutes must be an integer between 1 and ${SCANNER_MAX_PAUSE_DURATION_MINUTES}`,
            ),
        );
        return;
    }

    try {
        await requestScannerPause(
            mode,
            atBlock ?? null,
            mode === 'temporary'
                ? (durationMinutes ?? SCANNER_DEFAULT_PAUSE_DURATION_MINUTES)
                : SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
        );
        res.json({ message: 'Scanner pause requested', ...(await getScannerControlState()) });
    } catch (error) {
        sendHttpError(res, 'Unable to request scanner pause', error);
    }
};

export const resumeScannerController = async (_req: Request, res: Response): Promise<void> => {
    try {
        await resumeScanner();
        res.json({ message: 'Scanner resumed', ...(await getScannerControlState()) });
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
        res.json({
            message: 'Reorg recovery unblocked. Resume the scanner if it is paused.',
            reorgRecoveryActive: state.reorgRecoveryActive,
            reorgRecoveryBlocked: false,
            reorgRecoveryStartBlock: state.reorgRecoveryStartBlock,
            reorgRecoveryTargetBlock: state.reorgRecoveryTargetBlock,
        });
    } catch (error) {
        sendHttpError(res, 'Unable to retry reorg recovery', error);
    }
};
