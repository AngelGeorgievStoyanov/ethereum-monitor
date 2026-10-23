import { TransactionResponse } from 'ethers';
import { createScannerState, findScannerState, saveScannerState } from '../repositories/scannerStateRepository';
import { ethereumProvider, fetchBlockData } from './ethereumRpcService';
import { processNativeTransfers } from './nativeTransferService';
import { processErc20Transfers } from './erc20TransferService';
import { getConfigurationService } from './configurationService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';

const SCANNER_ID = 'ethereum-mainnet';
const POLL_INTERVAL_MS = 4000;

export function createBlockMonitorService() {
    const configurationService = getConfigurationService();
    let scannerStarted = false;
    let stopping = false;

    async function start() {
        if (scannerStarted) return;
        scannerStarted = true;

        try {
            let state = await findScannerState(SCANNER_ID);
            const rescanValue = process.env.RESCAN_FROM_BLOCK;
            const rescanBlock = rescanValue !== undefined ? Number(rescanValue) : undefined;
            const validRescanBlock = rescanBlock !== undefined
                && Number.isSafeInteger(rescanBlock)
                && rescanBlock >= 0;

            if (
                state
                && validRescanBlock
                && state.lastRescanFromBlock !== rescanBlock
            ) {
                state.lastProcessedBlock = rescanBlock - 1;
                state.lastRescanFromBlock = rescanBlock;
                await saveScannerState(state);
                console.log(`[Scanner] Rescan scheduled from block ${rescanBlock}`);
            }

            if (!state) {
                const configuredStart = process.env.START_BLOCK;
                const startBlock = configuredStart !== undefined ? Number(configuredStart) : undefined;
                let initialBlock: number;

                if (validRescanBlock) {
                    initialBlock = rescanBlock;
                } else if (
                    startBlock !== undefined
                    && Number.isSafeInteger(startBlock)
                    && startBlock >= 0
                ) {
                    initialBlock = startBlock;
                } else {
                    const finalized = await ethereumProvider.getBlock('finalized');
                    if (!finalized) throw new Error('Unable to resolve the latest finalized block');
                    initialBlock = finalized.number;
                }

                state = await createScannerState({
                    id: SCANNER_ID,
                    lastProcessedBlock: initialBlock - 1,
                    lastRescanFromBlock: validRescanBlock ? rescanBlock : null,
                });
            }

            console.log(`[Scanner] Started at checkpoint ${state.lastProcessedBlock}`);

            while (!stopping) {
                let processingBlock: number | undefined;

                try {
                    const finalized = await ethereumProvider.getBlock('finalized');
                    if (!finalized) throw new Error('Unable to resolve the latest finalized block');

                    if (configurationService.getConfigurations().length === 0) {
                        if (state.lastProcessedBlock < finalized.number) {
                            state.lastProcessedBlock = finalized.number;
                            await state.save();
                            console.log(`[Scanner] No active configurations; checkpoint advanced to ${finalized.number}`);
                        }
                    } else {
                        const catchupStartedAt = Date.now();
                        const catchupStartBlock = state.lastProcessedBlock + 1;
                        let processedBlocks = 0;

                        while (!stopping && state.lastProcessedBlock < finalized.number) {
                            const blockNumber = state.lastProcessedBlock + 1;
                            processingBlock = blockNumber;
                            const blockStartedAt = Date.now();
                            const { block, receipts, durationMs: fetchDurationMs, attempt } = await fetchBlockData(blockNumber);
                            const transactions = block.prefetchedTransactions;
                            const receiptsByHash = new Map<string, any>();

                            for (const receipt of receipts) {
                                receiptsByHash.set(String(receipt.transactionHash).toLowerCase(), receipt);
                            }

                            const transactionsByHash = new Map<string, TransactionResponse>();
                            for (const tx of transactions) {
                                transactionsByHash.set(tx.hash.toLowerCase(), tx);
                            }

                            const activeConfigurations = configurationService.getConfigurations();
                            const native = await processNativeTransfers(
                                transactions,
                                receiptsByHash,
                                activeConfigurations,
                                blockNumber,
                                block.timestamp
                            );
                            const erc20 = await processErc20Transfers(
                                receipts,
                                transactionsByHash,
                                activeConfigurations,
                                blockNumber,
                                block.timestamp
                            );

                            state.lastProcessedBlock = blockNumber;
                            await state.save();

                            const durationMs = Date.now() - blockStartedAt;
                            console.log(
                                `[Scanner] Block ${blockNumber} processed: tx=${transactions.length}, `
                                + `native matches=${native.transfersMatched}, ERC-20 matches=${erc20.transfersMatched}, `
                                + `fetch=${fetchDurationMs}ms, total=${durationMs}ms, checkpoint=${state.lastProcessedBlock}`
                                + (attempt > 1 ? `, fetch attempts=${attempt}` : '')
                            );

                            processingBlock = undefined;
                            processedBlocks += 1;
                        }

                        if (processedBlocks > 0) {
                            const durationMs = Date.now() - catchupStartedAt;
                            const blocksPerSecond = durationMs > 0
                                ? (processedBlocks * 1000 / durationMs).toFixed(2)
                                : 'n/a';
                            console.log(
                                `[Scanner] Catch-up complete: blocks ${catchupStartBlock}-${state.lastProcessedBlock}, `
                                + `count=${processedBlocks}, speed=${blocksPerSecond} blocks/s`
                            );
                        }
                    }
                } catch (error) {
                    const location = processingBlock === undefined ? '' : ` at block ${processingBlock}`;
                    const message = formatError(error);
                    console.error(`[Scanner] Processing failed${location}; checkpoint=${state.lastProcessedBlock}: ${message}`);
                }

                await sleep(POLL_INTERVAL_MS);
            }
        } catch (error) {
            scannerStarted = false;
            throw error;
        }
    }

    return { start };
}
