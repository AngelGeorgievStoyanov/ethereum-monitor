import type { ScannerState } from '../types/scanner-state.types';
import { createScannerState, findScannerState } from '../repositories/scannerStateRepository';
import { findCanonicalBlockIdentity } from '../repositories/blockRepository';
import { env } from '../config/env';
import { SCANNER_ID } from '../constants/scanner.constants';
import { evmRpcClient } from './evmBlockDataService';

export class UnsafeScannerStartError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsafeScannerStartError';
    }
}

export async function initializeScannerState(): Promise<ScannerState> {
    let state = await findScannerState(SCANNER_ID);

    if (state && state.lastProcessedBlock >= 0) {
        const storedBlock = await findCanonicalBlockIdentity(state.lastProcessedBlock);
        if (storedBlock) {
            const rpcBlock = await evmRpcClient.getBlock(state.lastProcessedBlock);
            if (
                !rpcBlock?.hash ||
                rpcBlock.hash.toLowerCase() !== storedBlock.blockHash.toLowerCase()
            ) {
                throw new UnsafeScannerStartError(
                    `Stored checkpoint block ${state.lastProcessedBlock} does not match the configured RPC network. Database "${SCANNER_ID}" may belong to another network.`,
                );
            }
            console.log(
                `[Scanner] Existing checkpoint verified against RPC at block ${state.lastProcessedBlock}`,
            );
        }
    }

    if (!state) {
        const finalized = await evmRpcClient.getBlock('finalized');
        if (!finalized) throw new Error('Unable to resolve the latest finalized block');

        let initialBlock: number;
        if (env.startBlock !== undefined) {
            if (env.startBlock > finalized.number) {
                throw new UnsafeScannerStartError(
                    `START_BLOCK ${env.startBlock} is above the latest finalized block ${finalized.number}`,
                );
            }

            const requestedStartBlock = await evmRpcClient.getBlock(env.startBlock);
            if (
                !requestedStartBlock ||
                requestedStartBlock.number !== env.startBlock ||
                !requestedStartBlock.hash ||
                !requestedStartBlock.parentHash
            ) {
                throw new Error(
                    `Unsafe scanner start: START_BLOCK ${env.startBlock} could not be verified by the RPC provider`,
                );
            }

            initialBlock = env.startBlock;
        } else {
            // No explicit start block means skip existing history and begin after the current finalized block.
            initialBlock = finalized.number + 1;
            if (!Number.isSafeInteger(initialBlock)) {
                throw new Error(
                    'Unsafe scanner start: latest finalized block cannot be incremented safely',
                );
            }
        }

        state = await createScannerState({
            id: SCANNER_ID,
            lastProcessedBlock: initialBlock - 1,
            lastRescanFromBlock: null,
        });
    }

    console.log(`[Scanner] Started at checkpoint ${state.lastProcessedBlock}`);
    return state;
}
