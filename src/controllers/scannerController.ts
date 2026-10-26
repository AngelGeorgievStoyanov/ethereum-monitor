import { Request, Response } from 'express';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';
import ScannerState from '../models/scannerState';
import { SCANNER_ID } from '../constants/scanner.constants';
import { HttpError, sendHttpError } from '../utils/httpError';

export const getScannerStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        const checkpoint = await ScannerState.findByPk(SCANNER_ID);
        res.json({
            ...getScannerControlState(),
            lastProcessedBlock: checkpoint?.lastProcessedBlock ?? null,
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
