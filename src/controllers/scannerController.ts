import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
    getScannerControlState,
    requestScannerPause,
    resumeScanner,
} from '../services/scannerControlService';
import ScannerState from '../models/scannerState';
import {
    SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
    SCANNER_ID,
    SCANNER_MAX_PAUSE_DURATION_MINUTES,
} from '../constants/scanner.constants';
import { HttpError, sendHttpError } from '../utils/httpError';
import {
    isScannerProcessingBlocks,
    releaseManualRescanReservation,
    tryReserveManualRescan,
} from '../services/blockMonitorService';
import { getTxFilterService } from '../services/txFilterService';
import { runManualRescan, RescanReorgDetectedError } from '../services/rescanService';
import { recordRescanFailure } from '../services/recoveryMetrics';
import { formatError } from '../utils/formatError';
import { isScannerLockHeld } from '../services/scannerLockService';
import { getScannerStatusResponse } from '../services/scannerStatusService';
import { countCanonicalBlocksInRange } from '../repositories/blockRepository';
import {
    createScannerRescanJob,
    findActiveScannerRescanJob,
    findScannerRescanJobById,
    updateScannerRescanJob,
} from '../repositories/scannerRescanJobRepository';
import type { ScannerRescanJobSummary } from '../types/scanner-status.types';
import { findScannerStatusState, unblockScannerReorgRecovery } from '../repositories/scannerStateRepository';

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

async function executeRescanJob(jobId: string, fromBlock: number, toBlock: number): Promise<void> {
    let job: ScannerRescanJobSummary | null = null;

    try {
        job = await findScannerRescanJobById(jobId);
        if (!job) {
            console.error(`[Rescan] Job ${jobId} was not found before execution`);
            return;
        }

        const state = await ScannerState.findByPk(SCANNER_ID);
        if (!state) throw new Error('Scanner state is not initialized');

        await updateScannerRescanJob(jobId, {
            status: 'RUNNING',
            currentBlock: fromBlock,
            startedAt: new Date(),
        });
        const result = await runManualRescan({
            fromBlock,
            state,
            getActiveTxFilters: () => getTxFilterService().getTxFilters(),
            onProgress: async (currentBlock, blocksProcessed) => {
                await updateScannerRescanJob(jobId, { currentBlock, blocksProcessed });
            },
        });
        await updateScannerRescanJob(jobId, {
            status: 'COMPLETED',
            currentBlock: result.toBlock,
            blocksProcessed: result.blocksProcessed,
            completedAt: new Date(),
            error: null,
        });
        await resumeScanner();
        console.log(
            `[Rescan] Job ${jobId} completed; range=${fromBlock}-${toBlock}; blocksProcessed=${result.blocksProcessed}; scanner resumed`,
        );
    } catch (error) {
        const message = formatError(error);
        if (error instanceof RescanReorgDetectedError && job) {
            await updateScannerRescanJob(jobId, {
                status: 'RECOVERY_STARTED',
                error: message,
                completedAt: new Date(),
            });
            console.warn(
                `[Rescan] Job ${jobId} detected a reorg; handing control to automatic recovery`,
            );
            try {
                await resumeScanner();
            } catch (resumeError) {
                console.error(
                    `[Rescan] Job ${jobId} could not resume scanner for recovery: ${formatError(resumeError)}`,
                );
            }
            return;
        }

        recordRescanFailure();
        try {
            if (!job) job = await findScannerRescanJobById(jobId);
            if (job) {
                await updateScannerRescanJob(jobId, {
                    status: 'FAILED',
                    error: message.slice(0, 1000),
                    completedAt: new Date(),
                });
            } else {
                console.error(
                    `[Rescan] Job ${jobId} could not be marked FAILED because its row could not be loaded`,
                );
            }
        } catch (statusError) {
            console.error(
                `[Rescan] Job ${jobId} status update failed: ${formatError(statusError)}`,
            );
        }
        console.error(`[Rescan] Job ${jobId} failed: ${message}`);
    } finally {
        releaseManualRescanReservation();
    }
}

export const rescanScannerController = async (req: Request, res: Response): Promise<void> => {
    const fromBlock = req.body?.fromBlock;
    let reservedForThisRequest = false;
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        res.status(400).json({ message: 'fromBlock must be a non-negative integer' });
        return;
    }

    const scannerControl = await getScannerControlState();
    if (!scannerControl.paused || scannerControl.mode !== 'manual') {
        res.status(409).json({
            message:
                'Pause the scanner with mode="manual" before starting a rescan; temporary pauses may expire during the operation.',
        });
        return;
    }
    if (!(await isScannerLockHeld())) {
        res.status(409).json({
            message:
                'Manual rescan must be started on the instance that currently owns the scanner lock.',
        });
        return;
    }
    if (isScannerProcessingBlocks()) {
        res.status(409).json({
            message:
                'The scanner is still finishing block processing. Retry the rescan after it becomes idle.',
        });
        return;
    }

    try {
        const state = await ScannerState.findByPk(SCANNER_ID);
        if (!state) {
            res.status(503).json({ message: 'Scanner state is not initialized' });
            return;
        }
        await state.reload();
        if (fromBlock > state.lastProcessedBlock) {
            res.status(400).json({
                message: `fromBlock ${fromBlock} is greater than the last processed checkpoint ${state.lastProcessedBlock}`,
            });
            return;
        }
        if (state.reorgRecoveryActive || state.reorgRecoveryBlocked) {
            res.status(409).json({
                message: 'Cannot start a rescan while reorg recovery is active or blocked.',
            });
            return;
        }

        const expectedBlocks = state.lastProcessedBlock - fromBlock + 1;
        const canonicalBlocks = await countCanonicalBlocksInRange(fromBlock, state.lastProcessedBlock);
        if (canonicalBlocks !== expectedBlocks) {
            res.status(409).json({
                message:
                    'Cannot start rescan because canonical block history is missing in the requested range.',
                fromBlock,
                toBlock: state.lastProcessedBlock,
                expectedBlocks,
                canonicalBlocksFound: canonicalBlocks,
            });
            return;
        }

        const activeJob = await findActiveScannerRescanJob();
        if (activeJob) {
            res.status(409).json({
                message: 'A rescan job is already running.',
                operationId: activeJob.id,
            });
            return;
        }

        if (!tryReserveManualRescan()) {
            res.status(409).json({
                message:
                    'The scanner is processing blocks or another rescan is reserved. Retry when it is idle.',
            });
            return;
        }
        reservedForThisRequest = true;

        const operationId = randomUUID();
        await createScannerRescanJob({
            id: operationId,
            fromBlock,
            toBlock: state.lastProcessedBlock,
        });

        void executeRescanJob(operationId, fromBlock, state.lastProcessedBlock).catch((error) => {
            releaseManualRescanReservation();
            console.error(
                `[Rescan] Job ${operationId} failed before its status could be updated: ${formatError(error)}`,
            );
        });
        reservedForThisRequest = false;
        res.status(202).json({
            message: 'Manual rescan started',
            operationId,
            status: 'QUEUED',
            fromBlock,
            toBlock: state.lastProcessedBlock,
            statusUrl: `/api/scanner/rescan/${operationId}`,
        });
    } catch (error) {
        if (reservedForThisRequest) releaseManualRescanReservation();
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
