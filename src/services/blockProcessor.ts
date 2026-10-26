import ScannerState from '../models/scannerState';
import { ActiveTxFilter } from './txFilterEvaluatorService';
import { shouldPauseBeforeBlock } from './scannerControlService';
import { updateScannerCheckpoint } from '../repositories/scannerStateRepository';
import { formatError } from '../utils/formatError';
import { processBlock } from './blockProcessingService';
import { logBlockProcessed, logCatchUpComplete } from '../utils/scannerLogger';
import { accumulateBlockMetrics, createBlockProcessingTotals } from './scannerMetrics';

export async function processFinalizedBlocks(
    state: ScannerState,
    finalizedBlockNumber: number,
    getActiveTxFilters: () => ActiveTxFilter[],
): Promise<void> {
    const catchupStartedAt = Date.now();
    const catchupStartBlock = state.lastProcessedBlock + 1;
    if (shouldPauseBeforeBlock(catchupStartBlock, state.lastProcessedBlock)) return;

    const totals = createBlockProcessingTotals();

    while (state.lastProcessedBlock < finalizedBlockNumber) {
        const blockNumber = state.lastProcessedBlock + 1;
        if (shouldPauseBeforeBlock(blockNumber, state.lastProcessedBlock)) return;
        const activeTxFilters = getActiveTxFilters();
        if (activeTxFilters.length === 0) return;

        try {
            const metrics = await processBlock(blockNumber, activeTxFilters);
            const checkpointStartedAt = Date.now();
            await updateScannerCheckpoint(state.id, blockNumber);
            const blockDurationMs = metrics.blockDurationMs + Date.now() - checkpointStartedAt;
            state.lastProcessedBlock = blockNumber;

            logBlockProcessed(blockNumber, metrics, blockDurationMs, state.lastProcessedBlock);
            accumulateBlockMetrics(totals, metrics, blockDurationMs);
        } catch (error) {
            console.error(
                `[Scanner] Processing failed at block ${blockNumber}; checkpoint=${state.lastProcessedBlock}: ${formatError(error)}`,
            );
            return;
        }
    }

    logCatchUpComplete({
        startBlock: catchupStartBlock,
        endBlock: state.lastProcessedBlock,
        durationMs: Date.now() - catchupStartedAt,
        ...totals,
    });
}
