import { HttpError } from '../utils/httpError';

export function validateScannerPauseInput(body: unknown): void {
    if (body === undefined || body === null) return;
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be an empty JSON object');
    }
    if (Object.keys(body).length > 0) {
        throw new HttpError(400, 'Scanner pause does not accept options');
    }
}
