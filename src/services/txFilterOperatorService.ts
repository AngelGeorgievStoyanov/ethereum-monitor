import { getTxFilterField } from './txFilterFieldRegistry';

export type TxFilterOperator =
    'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'contains';

const OPERATORS = new Set<TxFilterOperator>([
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'notIn',
    'contains',
]);

function normalize(value: unknown, type: string, caseInsensitive: boolean): unknown {
    if (value === null || value === undefined) return value;
    if (type === 'bigint') {
        if (typeof value !== 'string' && typeof value !== 'bigint') {
            throw new Error('Big integer filter values must be exact integer strings');
        }
        const stringValue = String(value);
        if (!/^-?\d+$/.test(stringValue)) throw new Error('Invalid integer filter value');
        return BigInt(stringValue);
    }
    if (type === 'number') {
        if (typeof value !== 'number' && typeof value !== 'string') {
            throw new Error('Numeric filter values must be numbers');
        }
        const numberValue = Number(value);
        if (!Number.isSafeInteger(numberValue)) {
            throw new Error('Numeric filter values must be safe integers');
        }
        return numberValue;
    }
    if (type === 'date') {
        if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
            throw new Error('Date filter values must be dates, strings, or timestamps');
        }
        const dateValue = (value instanceof Date ? value : new Date(value)).getTime();
        if (!Number.isFinite(dateValue)) throw new Error('Invalid date filter value');
        return dateValue;
    }
    if (typeof value !== 'string') throw new Error('String filter values must be strings');
    return caseInsensitive ? value.toLowerCase() : value;
}

export function validateTxFilterOperator(field: string, operator: string, value: unknown): void {
    if (!OPERATORS.has(operator as TxFilterOperator)) {
        throw new Error(`Unsupported transaction filter operator "${operator}"`);
    }
    const definition = getTxFilterField(field);
    if (
        ['gt', 'gte', 'lt', 'lte'].includes(operator) &&
        !['number', 'bigint', 'date'].includes(definition.type)
    ) {
        throw new Error(`Operator "${operator}" is not supported for field "${field}"`);
    }
    if (operator === 'contains' && definition.type !== 'string') {
        throw new Error(`Operator "contains" is only supported for string fields`);
    }
    if (operator === 'contains' && typeof value !== 'string') {
        throw new Error('Operator "contains" requires a string value');
    }
    if ((operator === 'in' || operator === 'notIn') && !Array.isArray(value)) {
        throw new Error(`Operator "${operator}" requires an array value`);
    }
    const values = operator === 'in' || operator === 'notIn' ? (value as unknown[]) : [value];
    for (const item of values)
        normalize(item, definition.type, Boolean(definition.caseInsensitive));
}

export function evaluateTxFilterOperator(
    field: string,
    operator: string,
    actualValue: unknown,
    expectedValue: unknown,
): boolean {
    validateTxFilterOperator(field, operator, expectedValue);
    const definition = getTxFilterField(field);
    const actual = normalize(actualValue, definition.type, Boolean(definition.caseInsensitive));
    if (operator === 'in' || operator === 'notIn') {
        const found =
            Array.isArray(expectedValue) &&
            expectedValue.some(
                (item) =>
                    actual ===
                    normalize(item, definition.type, Boolean(definition.caseInsensitive)),
            );
        if (operator === 'in') return found;
        return actual !== null && actual !== undefined && !found;
    }
    const expected = normalize(expectedValue, definition.type, Boolean(definition.caseInsensitive));

    if (operator === 'eq') return actual === expected;
    if (operator === 'ne') {
        if (actual === null || actual === undefined) return false;
        if (expected === null || expected === undefined) return true;
        return actual !== expected;
    }
    if (operator === 'contains') {
        return (
            typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
        );
    }
    if (actual === null || actual === undefined || expected === null || expected === undefined) {
        return false;
    }

    if (typeof actual === 'bigint' && typeof expected === 'bigint') {
        switch (operator) {
            case 'gt':
                return actual > expected;
            case 'gte':
                return actual >= expected;
            case 'lt':
                return actual < expected;
            case 'lte':
                return actual <= expected;
            default:
                return false;
        }
    }
    if (typeof actual === 'number' && typeof expected === 'number') {
        switch (operator) {
            case 'gt':
                return actual > expected;
            case 'gte':
                return actual >= expected;
            case 'lt':
                return actual < expected;
            case 'lte':
                return actual <= expected;
            default:
                return false;
        }
    }
    return false;
}
