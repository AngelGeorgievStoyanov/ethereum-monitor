import {
    SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
    SCANNER_MAX_PAUSE_DURATION_MINUTES,
} from '../constants/scanner.constants';
import type { ScannerPauseMode } from '../types/scanner-status.types';
import { HttpError } from '../utils/httpError';

export interface ScannerPauseInput {
    mode: ScannerPauseMode;
    atBlock: number | null;
    durationMinutes: number;
}

function getBody(body: unknown): Record<string, unknown> {
    if (body === undefined || body === null) return {};
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object');
    }
    return body as Record<string, unknown>;
}

export function validateScannerPauseInput(body: unknown): ScannerPauseInput {
    const input = getBody(body);
    const mode = input.mode ?? 'temporary';
    const atBlock = input.atBlock;
    const durationMinutes = input.durationMinutes;

    if (mode !== 'manual' && mode !== 'temporary') {
        throw new HttpError(400, 'mode must be "manual" or "temporary"');
    }
    if (atBlock !== undefined && (!Number.isSafeInteger(atBlock) || (atBlock as number) < 0)) {
        throw new HttpError(400, 'atBlock must be a non-negative integer');
    }
    if (
        durationMinutes !== undefined &&
        (!Number.isSafeInteger(durationMinutes) ||
            (durationMinutes as number) < 1 ||
            (durationMinutes as number) > SCANNER_MAX_PAUSE_DURATION_MINUTES)
    ) {
        throw new HttpError(
            400,
            `durationMinutes must be an integer between 1 and ${SCANNER_MAX_PAUSE_DURATION_MINUTES}`,
        );
    }

    return {
        mode: mode as ScannerPauseMode,
        atBlock: atBlock === undefined ? null : (atBlock as number),
        durationMinutes:
            mode === 'temporary'
                ? ((durationMinutes as number | undefined) ??
                  SCANNER_DEFAULT_PAUSE_DURATION_MINUTES)
                : SCANNER_DEFAULT_PAUSE_DURATION_MINUTES,
    };
}
