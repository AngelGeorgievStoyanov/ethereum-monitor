import { HttpError } from '../utils/httpError';

export function validateManualRescanFromBlock(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new HttpError(400, 'fromBlock must be a non-negative integer');
    }
    return value;
}
