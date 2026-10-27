import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
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
import { getRecoveryMetrics, recordRescanFailure } from '../services/recoveryMetrics';
import ScannerRescanJob from '../models/scannerRescanJob';
import { formatError } from '../utils/formatError';

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
            reorgRecoveryBlocked: checkpoint?.reorgRecoveryBlocked ?? false,
            reorgRecoveryBlockReason: checkpoint?.reorgRecoveryBlockReason ?? null,
            reorgRecoveryStableBlocks: checkpoint?.reorgRecoveryStableBlocks ?? 0,
            reorgRecoveryStartBlock: checkpoint?.reorgRecoveryStartBlock ?? null,
            reorgRecoveryTargetBlock: checkpoint?.reorgRecoveryTargetBlock ?? null,
            rescanJob: await ScannerRescanJob.findOne({ order: [['createdAt', 'DESC']] }),
            recoveryMetrics: getRecoveryMetrics(),
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


async function executeRescanJob(jobId: string, fromBlock: number, toBlock: number): Promise<void> {
    const job = await ScannerRescanJob.findByPk(jobId);
    if (!job) return;

    try {
        const state = await ScannerState.findByPk(SCANNER_ID);
        if (!state) throw new Error('Scanner state is not initialized');

        await job.update({ status: 'RUNNING', currentBlock: fromBlock, startedAt: new Date() });
        const result = await runManualRescan(
            fromBlock,
            state,
            () => getTxFilterService().getTxFilters(),
            async (currentBlock, blocksProcessed) => {
                await job.update({ currentBlock, blocksProcessed });
            },
        );
        await job.update({
            status: 'COMPLETED',
            currentBlock: result.toBlock,
            blocksProcessed: result.blocksProcessed,
            completedAt: new Date(),
            error: null,
        });
        console.log(`[Rescan] Job ${jobId} completed; range=${fromBlock}-${toBlock}; blocksProcessed=${result.blocksProcessed}`);
    } catch (error) {
        const message = formatError(error);
        if (error instanceof RescanReorgDetectedError) {
            await job.update({
                status: 'RECOVERY_STARTED',
                error: message,
                completedAt: new Date(),
            });
            console.warn(`[Rescan] Job ${jobId} detected a reorg; handing control to automatic recovery`);
            try {
                resumeScanner();
            } catch (resumeError) {
                console.error(`[Rescan] Job ${jobId} could not resume scanner for recovery: ${formatError(resumeError)}`);
            }
            return;
        }

        recordRescanFailure();
        await job.update({
            status: 'FAILED',
            error: message.slice(0, 1000),
            completedAt: new Date(),
        });
        console.error(`[Rescan] Job ${jobId} failed: ${message}`);
    }
}

export const rescanScannerController = async (req: Request, res: Response): Promise<void> => {
    const fromBlock = req.body?.fromBlock;
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        res.status(400).json({ message: 'fromBlock must be a non-negative integer' });
        return;
    }

    const scannerControl = getScannerControlState();
    if (!scannerControl.paused || scannerControl.mode !== 'manual') {
        res.status(409).json({ message: 'Pause the scanner with mode="manual" before starting a rescan; temporary pauses may expire during the operation.' });
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
        await state.reload();
        if (fromBlock > state.lastProcessedBlock) {
            res.status(400).json({
                message: `fromBlock ${fromBlock} is greater than the last processed checkpoint ${state.lastProcessedBlock}`,
            });
            return;
        }
        if (state.reorgRecoveryActive || state.reorgRecoveryBlocked) {
            res.status(409).json({ message: 'Cannot start a rescan while reorg recovery is active or blocked.' });
            return;
        }

        const activeJob = await ScannerRescanJob.findOne({
            where: { status: { [Op.in]: ['QUEUED', 'RUNNING'] } },
        });
        if (activeJob) {
            res.status(409).json({ message: 'A rescan job is already running.', operationId: activeJob.id });
            return;
        }

        const operationId = randomUUID();
        await ScannerRescanJob.create({
            id: operationId,
            fromBlock,
            toBlock: state.lastProcessedBlock,
            currentBlock: fromBlock,
            blocksProcessed: 0,
            status: 'QUEUED',
            error: null,
            startedAt: null,
            completedAt: null,
        });

        void executeRescanJob(operationId, fromBlock, state.lastProcessedBlock);
        res.status(202).json({
            message: 'Manual rescan started',
            operationId,
            status: 'QUEUED',
            fromBlock,
            toBlock: state.lastProcessedBlock,
            statusUrl: `/api/scanner/rescan/${operationId}`,
        });
    } catch (error) {
        sendHttpError(res, 'Unable to start manual rescan', error);
    }
};

export const getRescanJobStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const operationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const job = await ScannerRescanJob.findByPk(operationId);
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
        const state = await ScannerState.findByPk(SCANNER_ID);
        if (!state || !state.reorgRecoveryActive) {
            res.status(409).json({ message: 'No pending reorg recovery is available to retry.' });
            return;
        }
        if (!state.reorgRecoveryBlocked) {
            res.status(409).json({ message: 'Reorg recovery is not blocked; no explicit retry is needed.' });
            return;
        }
        state.reorgRecoveryBlocked = false;
        state.reorgRecoveryBlockReason = null;
        await state.save();
        res.json({
            message: 'Reorg recovery unblocked. Resume the scanner if it is paused.',
            reorgRecoveryActive: state.reorgRecoveryActive,
            reorgRecoveryBlocked: state.reorgRecoveryBlocked,
            reorgRecoveryStartBlock: state.reorgRecoveryStartBlock,
            reorgRecoveryTargetBlock: state.reorgRecoveryTargetBlock,
        });
    } catch (error) {
        sendHttpError(res, 'Unable to retry reorg recovery', error);
    }
};
