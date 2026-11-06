import type { TxFilterRule } from '../types/tx-filter.types';
import { HttpError } from '../utils/httpError';
import { parsePositiveId } from '../utils/parsePositiveId';
import { validateTxFilterRule } from '../services/txFilterValidationService';

export interface CreateTxFilterInput {
    description: string;
    isActive: boolean;
    rule: TxFilterRule;
}

export interface UpdateTxFilterInput {
    description?: string;
    isActive?: boolean;
    rule?: TxFilterRule;
}

function getBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object');
    }
    return body as Record<string, unknown>;
}

function validateRuleShape(rule: unknown): asserts rule is TxFilterRule {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new HttpError(400, 'rule must be a JSON object');
    }
    validateTxFilterRule(rule as TxFilterRule);
}

export function validateCreateTxFilterInput(body: unknown): CreateTxFilterInput {
    const input = getBody(body);
    const { description, isActive, rule } = input;

    if (typeof description !== 'string' || description.trim().length === 0) {
        throw new HttpError(400, 'A filter description is required');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
        throw new HttpError(400, 'isActive must be a boolean');
    }
    validateRuleShape(rule);

    return {
        description: description.trim(),
        isActive: (isActive as boolean | undefined) ?? true,
        rule,
    };
}

export function validateUpdateTxFilterInput(body: unknown): UpdateTxFilterInput {
    const input = getBody(body);
    const { description, isActive, rule } = input;

    if (
        description !== undefined &&
        (typeof description !== 'string' || description.trim().length === 0)
    ) {
        throw new HttpError(400, 'Filter description must be a non-empty string');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
        throw new HttpError(400, 'isActive must be a boolean');
    }
    if (rule !== undefined) validateRuleShape(rule);

    return {
        ...(description !== undefined ? { description: (description as string).trim() } : {}),
        ...(isActive !== undefined ? { isActive: isActive as boolean } : {}),
        ...(rule !== undefined ? { rule } : {}),
    };
}

export function validateTxFilterIdInput(value: unknown): number {
    const id = typeof value === 'string' ? parsePositiveId(value) : undefined;
    if (id === undefined) throw new HttpError(400, 'Invalid transaction filter ID');
    return id;
}
