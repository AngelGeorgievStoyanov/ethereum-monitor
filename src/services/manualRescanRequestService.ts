import { randomUUID } from 'crypto';
import { SCANNER_ID } from '../constants/scanner.constants';
import {
    isScannerProcessingBlocks,
    releaseManualRescanReservation,
    tryReserveManualRescan,
} from './blockMonitorService';
import { isScannerLockHeld } from './scannerLockService';
import { getScannerControlState } from './scannerControlService';
import { countCanonicalBlocksInRange } from '../repositories/blockRepository';
import {
    createScannerRescanJob,
    findActiveScannerRescanJob,
} from '../repositories/scannerRescanJobRepository';
import { findScannerStatusState } from '../repositories/scannerStateRepository';
import { executeRescanJob } from './scannerRescanJobService';
import { formatError } from '../utils/formatError';
import { mapManualRescanResponse } from '../mappers/manualRescanMapper';

export interface ManualRescanErrorResponse {
    message: string;
    fromBlock?: number;
    toBlock?: number;
    expectedBlocks?: number;
    canonicalBlocksFound?: number;
    operationId?: string;
}

export type ManualRescanRequestResult =
    | {
          kind: 'started';
          operationId: string;
          status: 'QUEUED';
          fromBlock: number;
          toBlock: number;
      }
    | {
          kind: 'rejected';
          reason: 'bad-request' | 'conflict' | 'unavailable';
          body: ManualRescanErrorResponse;
      };

function rejected(
    reason: Extract<ManualRescanRequestResult, { kind: 'rejected' }>['reason'],
    body: ManualRescanErrorResponse,
): ManualRescanRequestResult {
    return { kind: 'rejected', reason, body };
}

async function requestManualRescanOperation(
    requestedFromBlock: number,
): Promise<ManualRescanRequestResult> {
    const scannerControl = await getScannerControlState();
    if (!scannerControl.paused || scannerControl.mode !== 'manual') {
        return rejected('conflict', {
            message:
                'Pause the scanner with mode="manual" before starting a rescan; temporary pauses may expire during the operation.',
        });
    }
    if (!(await isScannerLockHeld())) {
        return rejected('conflict', {
            message:
                'Manual rescan must be started on the instance that currently owns the scanner lock.',
        });
    }
    if (isScannerProcessingBlocks()) {
        return rejected('conflict', {
            message:
                'The scanner is still finishing block processing. Retry the rescan after it becomes idle.',
        });
    }

    let reservedForRequest = false;
    try {
        const state = await findScannerStatusState(SCANNER_ID);
        if (!state) return rejected('unavailable', { message: 'Scanner state is not initialized' });

        if (requestedFromBlock > state.lastProcessedBlock) {
            return rejected('bad-request', {
                message: `fromBlock ${requestedFromBlock} is greater than the last processed checkpoint ${state.lastProcessedBlock}`,
            });
        }
        if (state.reorgRecoveryActive || state.reorgRecoveryBlocked) {
            return rejected('conflict', {
                message: 'Cannot start a rescan while reorg recovery is active or blocked.',
            });
        }

        const expectedBlocks = state.lastProcessedBlock - requestedFromBlock + 1;
        const canonicalBlocks = await countCanonicalBlocksInRange(
            requestedFromBlock,
            state.lastProcessedBlock,
        );
        if (canonicalBlocks !== expectedBlocks) {
            return rejected('conflict', {
                message:
                    'Cannot start rescan because canonical block history is missing in the requested range.',
                fromBlock: requestedFromBlock,
                toBlock: state.lastProcessedBlock,
                expectedBlocks,
                canonicalBlocksFound: canonicalBlocks,
            });
        }

        const activeJob = await findActiveScannerRescanJob();
        if (activeJob) {
            return rejected('conflict', {
                message: 'A rescan job is already running.',
                operationId: activeJob.id,
            });
        }

        if (!tryReserveManualRescan()) {
            return rejected('conflict', {
                message:
                    'The scanner is processing blocks or another rescan is reserved. Retry when it is idle.',
            });
        }
        reservedForRequest = true;

        const operationId = randomUUID();
        await createScannerRescanJob({
            id: operationId,
            fromBlock: requestedFromBlock,
            toBlock: state.lastProcessedBlock,
        });

        void executeRescanJob(operationId, requestedFromBlock, state.lastProcessedBlock).catch(
            (error) => {
                releaseManualRescanReservation();
                console.error(
                    `[Rescan] Job ${operationId} failed before its status could be updated: ${formatError(error)}`,
                );
            },
        );
        reservedForRequest = false;
        return {
            kind: 'started',
            operationId,
            status: 'QUEUED',
            fromBlock: requestedFromBlock,
            toBlock: state.lastProcessedBlock,
        };
    } catch (error) {
        if (reservedForRequest) releaseManualRescanReservation();
        throw error;
    }
}

export async function requestManualRescan(requestedFromBlock: number) {
    const result = await requestManualRescanOperation(requestedFromBlock);
    return { ...result, response: mapManualRescanResponse(result) };
}
