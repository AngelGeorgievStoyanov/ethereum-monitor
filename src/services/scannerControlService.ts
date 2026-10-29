import { SCANNER_DEFAULT_PAUSE_DURATION_MINUTES, SCANNER_ID } from '../constants/scanner.constants';
import {
    findScannerControlRecord,
    updateScannerControlRecord,
} from '../repositories/scannerStateRepository';
import type {
    ScannerControlRecord,
    ScannerControlState,
    ScannerPauseMode,
} from '../types/scanner-status.types';

function toControlState(record: ScannerControlRecord | null): ScannerControlState {
    return {
        paused: record?.paused ?? false,
        mode: record?.mode ?? null,
        pauseRequestedAtBlock: record?.pauseRequestedAtBlock ?? null,
        pauseUntil: record?.pauseUntil ?? null,
    };
}

async function loadControlRecord(): Promise<ScannerControlRecord> {
    const record = await findScannerControlRecord(SCANNER_ID);
    if (!record) throw new Error('Scanner state is not initialized yet');
    return record;
}

function isTemporaryPauseExpired(record: ScannerControlRecord): boolean {
    return Boolean(
        record.paused &&
            record.mode === 'temporary' &&
            record.pauseUntilDate &&
            Date.now() >= record.pauseUntilDate.getTime(),
    );
}

export async function isScannerPausePendingOrActive(): Promise<boolean> {
    const record = await loadControlRecord();
    if (isTemporaryPauseExpired(record)) {
        await resumeScanner();
        return false;
    }
    return record.paused || record.pauseTargetBlock !== null;
}

export async function getScannerControlState(): Promise<ScannerControlState> {
    const record = await findScannerControlRecord(SCANNER_ID);
    if (!record) return toControlState(null);

    if (isTemporaryPauseExpired(record)) {
        await resumeScanner();
        return toControlState(null);
    }
    return toControlState(record);
}

export async function requestScannerPause(
    mode: ScannerPauseMode,
    atBlock: number | null,
    durationMinutes = SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
): Promise<void> {
    const paused = atBlock === null;
    const pauseUntil =
        paused && mode === 'temporary'
            ? new Date(Date.now() + durationMinutes * 60 * 1000)
            : null;

    await updateScannerControlRecord(SCANNER_ID, {
        scannerPauseTargetBlock: atBlock,
        scannerPaused: paused,
        scannerPauseMode: mode,
        scannerPauseRequestedAtBlock: atBlock,
        scannerPauseDurationMinutes: durationMinutes,
        scannerPauseUntil: pauseUntil,
    });

    console.log(
        paused
            ? `[Scanner] Persisted pause (${mode}); checkpoint will be preserved`
            : `[Scanner] Persisted pause request after block ${atBlock} (${mode})`,
    );
}

export async function shouldPauseBeforeBlock(
    nextBlock: number,
    lastProcessedBlock: number,
): Promise<boolean> {
    const record = await loadControlRecord();
    if (isTemporaryPauseExpired(record)) {
        await resumeScanner();
        return false;
    }

    if (record.paused) return true;
    if (
        record.pauseTargetBlock !== null &&
        nextBlock > record.pauseTargetBlock &&
        lastProcessedBlock >= record.pauseTargetBlock
    ) {
        const pauseUntil =
            record.mode === 'temporary'
                ? new Date(Date.now() + record.pauseDurationMinutes * 60 * 1000)
                : null;
        await updateScannerControlRecord(SCANNER_ID, {
            scannerPaused: true,
            scannerPauseTargetBlock: null,
            scannerPauseUntil: pauseUntil,
        });

        const resumeMessage = pauseUntil
            ? `; auto-resume in ${record.pauseDurationMinutes} minute(s)`
            : '; manual resume required';
        console.log(`[Scanner] Paused at checkpoint ${lastProcessedBlock}${resumeMessage}`);
        return true;
    }
    return false;
}

export async function resumeScanner(): Promise<void> {
    const record = await findScannerControlRecord(SCANNER_ID);
    if (!record) return;

    const wasPaused = record.paused || record.pauseTargetBlock !== null;
    await updateScannerControlRecord(SCANNER_ID, {
        scannerPaused: false,
        scannerPauseMode: null,
        scannerPauseRequestedAtBlock: null,
        scannerPauseUntil: null,
        scannerPauseTargetBlock: null,
        scannerPauseDurationMinutes: SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
    });
    if (wasPaused) {
        console.log('[Scanner] Persisted resume; catch-up will continue from the saved checkpoint');
    }
}
