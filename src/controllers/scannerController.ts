import { Request, Response } from 'express';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';
import ScannerState from '../models/scannerState';
import { SCANNER_ID } from '../constants/scanner.constants';

export const getScannerStatus = async (_req: Request, res: Response) => {
    try {
        const checkpoint = await ScannerState.findByPk(SCANNER_ID);
        res.json({
            ...getScannerControlState(),
            lastProcessedBlock: checkpoint?.lastProcessedBlock ?? null,
        });
    } catch {
        res.status(500).json({ message: 'Unable to retrieve scanner status' });
    }
};

export const pauseScanner = (req: Request, res: Response) => {
    const mode = req.body?.mode ?? 'temporary';
    const atBlock = req.body?.atBlock;
    if (mode !== 'manual' && mode !== 'temporary') {
        res.status(400).json({ message: 'mode must be "manual" or "temporary"' });
        return;
    }
    if (atBlock !== undefined && (!Number.isSafeInteger(atBlock) || atBlock < 0)) {
        res.status(400).json({ message: 'atBlock must be a non-negative integer' });
        return;
    }
    requestScannerPause(mode, atBlock ?? null);
    res.json({ message: 'Scanner pause requested', ...getScannerControlState() });
};

export const resumeScannerController = (_req: Request, res: Response) => {
    resumeScanner();
    res.json({ message: 'Scanner resumed', ...getScannerControlState() });
};
