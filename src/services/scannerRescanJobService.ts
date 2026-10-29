import { findScannerState } from '../repositories/scannerStateRepository';
import {
    findScannerRescanJobById,
    updateScannerRescanJob,
} from '../repositories/scannerRescanJobRepository';
import { SCANNER_ID } from '../constants/scanner.constants';
import { getDynamicConfigService } from './dynamicConfigService';
import { runManualRescan, RescanReorgDetectedError } from './rescanService';
import { recordRescanFailure } from './recoveryMetrics';
import { formatError } from '../utils/formatError';
import { resumeScanner } from './scannerControlService';
import { releaseManualRescanReservation } from './blockMonitorService';
import type { ScannerRescanJobSummary } from '../types/scanner-status.types';

export async function executeRescanJob(
    jobId: string,
    fromBlock: number,
    toBlock: number,
): Promise<void> {
    let job: ScannerRescanJobSummary | null = null;

    try {
        job = await findScannerRescanJobById(jobId);
        if (!job) {
            console.error(`[Rescan] Job ${jobId} was not found before execution`);
            return;
        }

        const state = await findScannerState(SCANNER_ID);
        if (!state) throw new Error('Scanner state is not initialized');

        await updateScannerRescanJob(jobId, {
            status: 'RUNNING',
            currentBlock: fromBlock,
            startedAt: new Date(),
        });
        const result = await runManualRescan({
            fromBlock,
            state,
            getActiveTxFilters: () => getDynamicConfigService().getTxFilters(),
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
