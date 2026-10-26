import { TxFilterGroupRule } from '../services/txFilterEvaluatorService';
import { HttpError } from '../utils/httpError';

export interface CreateTxFilterInput {
    description: string;
    from: string | null;
    to: string | null;
    isActive: boolean;
    rule?: TxFilterGroupRule;
}

export interface UpdateTxFilterInput {
    description?: string;
    from?: string | null;
    to?: string | null;
    isActive?: boolean;
    rule?: TxFilterGroupRule | null;
}

function getBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object');
    }
    return body as Record<string, unknown>;
}

function validateAddresses(from: unknown, to: unknown): void {
    if (
        (from !== undefined && from !== null && typeof from !== 'string') ||
        (to !== undefined && to !== null && typeof to !== 'string')
    ) {
        throw new HttpError(400, 'from and to must be strings or null');
    }
}

export function validateCreateTxFilterInput(body: unknown): CreateTxFilterInput {
    const input = getBody(body);
    const { description, from, to, isActive, rule } = input;

    if (typeof description !== 'string' || description.trim().length === 0) {
        throw new HttpError(400, 'A filter description is required');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
        throw new HttpError(400, 'isActive must be a boolean');
    }
    validateAddresses(from, to);

    return {
        description: description.trim(),
        from: typeof from === 'string' && from.length > 0 ? from : null,
        to: typeof to === 'string' && to.length > 0 ? to : null,
        isActive: (isActive as boolean | undefined) ?? true,
        ...(rule !== undefined && rule !== null ? { rule: rule as TxFilterGroupRule } : {}),
    };
}

export function validateUpdateTxFilterInput(body: unknown): UpdateTxFilterInput {
    const input = getBody(body);
    const { description, from, to, isActive, rule } = input;

    if (
        description !== undefined &&
        (typeof description !== 'string' || description.trim().length === 0)
    ) {
        throw new HttpError(400, 'Filter description must be a non-empty string');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
        throw new HttpError(400, 'isActive must be a boolean');
    }
    validateAddresses(from, to);

    return {
        ...(description !== undefined ? { description: (description as string).trim() } : {}),
        ...(from !== undefined
            ? { from: typeof from === 'string' && from.length > 0 ? from : null }
            : {}),
        ...(to !== undefined ? { to: typeof to === 'string' && to.length > 0 ? to : null } : {}),
        ...(isActive !== undefined ? { isActive: isActive as boolean } : {}),
        ...(rule !== undefined ? { rule: rule === null ? null : (rule as TxFilterGroupRule) } : {}),
    };
}
