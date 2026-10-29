import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '../constants/transaction.constants';
import { HttpError } from '../utils/httpError';
import { parsePositiveId } from '../utils/parsePositiveId';

export interface TransactionPaginationInput {
    page: number;
    limit: number;
}

function parsePositiveQueryInteger(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function validateTransactionPaginationInput(query: {
    page?: unknown;
    limit?: unknown;
}): TransactionPaginationInput {
    const page = query.page === undefined ? DEFAULT_PAGE : parsePositiveQueryInteger(query.page);
    const limit =
        query.limit === undefined ? DEFAULT_LIMIT : parsePositiveQueryInteger(query.limit);

    if (page === undefined || limit === undefined || limit > MAX_LIMIT) {
        throw new HttpError(
            400,
            `Invalid pagination parameters. page must be a positive integer and limit must be between 1 and ${MAX_LIMIT}.`,
        );
    }
    return { page, limit };
}

export function validateTransactionIdInput(value: unknown): number {
    const id = typeof value === 'string' ? parsePositiveId(value) : undefined;
    if (id === undefined) throw new HttpError(400, 'Invalid transaction ID');
    return id;
}
