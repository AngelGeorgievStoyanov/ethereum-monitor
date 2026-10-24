import { TransactionResponse } from 'ethers';
import { RpcTransactionReceipt } from '../types/ethereum-rpc.types';
import { createScannerState, findScannerState, saveScannerState } from '../repositories/scannerStateRepository';
import { env } from '../config/env';
import { SCANNER_ID, SCANNER_POLL_INTERVAL_MS } from '../constants/scanner.constants';
import { ethereumProvider, fetchBlockData } from './ethereumRpcService';
import { processNativeTransfers } from './nativeTransferService';
import { processErc20Transfers } from './erc20TransferService';
import { getConfigurationService } from './configurationService';
import { formatError } from '../utils/formatError';
import { sleep } from '../utils/sleep';

export function createBlockMonitorService() {
    const configurationService = getConfigurationService();
    let scannerStarted = false;

    async function start() {
        if (scannerStarted) return;
        scannerStarted = true;

        try {
            let state = await findScannerState(SCANNER_ID);
            const rescanBlock = env.rescanFromBlock;
            const validRescanBlock = rescanBlock !== undefined;

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
                const startBlock = env.startBlock;
                let initialBlock: number;

                if (rescanBlock !== undefined) {
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

            while (true) {
                let processingBlock: number | undefined;

                try {
                    const finalized = await ethereumProvider.getBlock('finalized');
                    if (!finalized) throw new Error('Unable to resolve the latest finalized block');

                    if (configurationService.getConfigurations().length === 0) {
                        if (state.lastProcessedBlock < finalized.number) {
                            state.lastProcessedBlock = finalized.number;
                            await saveScannerState(state);
                            console.log(`[Scanner] No active configurations; checkpoint advanced to ${finalized.number}`);
                        }
                    } else {
                        const catchupStartedAt = Date.now();
                        const catchupStartBlock = state.lastProcessedBlock + 1;
                        let processedBlocks = 0;

                        while (state.lastProcessedBlock < finalized.number) {
                            const blockNumber = state.lastProcessedBlock + 1;
                            processingBlock = blockNumber;
                            const blockStartedAt = Date.now();
                            const { block, receipts, durationMs: fetchDurationMs, attempt } = await fetchBlockData(blockNumber);
                            const transactions = block.prefetchedTransactions;
                            const receiptsByHash = new Map<string, RpcTransactionReceipt>();

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
                            await saveScannerState(state);

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

                await sleep(SCANNER_POLL_INTERVAL_MS);
            }
        } catch (error) {
            scannerStarted = false;
            throw error;
        }
    }

    return { start };
}
