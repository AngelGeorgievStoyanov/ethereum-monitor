import { MAX_FILTER_ARRAY_VALUES } from '../constants/tx-filter.constants';
import type { TxFilterFieldDefinition } from './txFilterFieldRegistry';

export interface TxFilterOperatorDefinition {
    template: string;
    valueMode?: 'single' | 'set' | 'range';
}

const comparable =
    '$actual !== null && $actual !== undefined && $expected !== null && $expected !== undefined';

export const TX_FILTER_OPERATORS: Record<string, TxFilterOperatorDefinition> = {
    eq: { template: '($actual === $expected)' },
    ne: { template: '($actual !== null && $actual !== undefined && $actual !== $expected)' },
    gt: { template: `(${comparable} && $actual > $expected)` },
    gte: { template: `(${comparable} && $actual >= $expected)` },
    lt: { template: `(${comparable} && $actual < $expected)` },
    lte: { template: `(${comparable} && $actual <= $expected)` },
    in: { template: '($constant.has($actual))', valueMode: 'set' },
    notIn: {
        template: '($actual !== null && $actual !== undefined && !$constant.has($actual))',
        valueMode: 'set',
    },
    contains: { template: '($actual !== null && $actual !== undefined && $actual.includes($expected))' },
    between: {
        template:
            '($actual !== null && $actual !== undefined && $lower !== null && $upper !== null && $actual >= $lower && $actual <= $upper)',
        valueMode: 'range',
    },
};

export function getTxFilterOperator(operator: string): TxFilterOperatorDefinition {
    if (!Object.prototype.hasOwnProperty.call(TX_FILTER_OPERATORS, operator)) {
        throw new Error(`Unsupported transaction filter operator "${operator}"`);
    }
    return TX_FILTER_OPERATORS[operator];
}

export function normalizeTxFilterValue(
    value: unknown,
    field: TxFilterFieldDefinition,
): unknown {
    if (value === null || value === undefined) return value;

    if (field.type === 'bigint') {
        if (typeof value !== 'string' && typeof value !== 'bigint') {
            throw new Error('Big integer filter values must be exact integer strings');
        }
        const stringValue = String(value);
        if (!/^-?\d+$/.test(stringValue)) throw new Error('Invalid integer filter value');
        return BigInt(stringValue);
    }

    if (field.type === 'number') {
        if (typeof value !== 'number' && typeof value !== 'string') {
            throw new Error('Numeric filter values must be numbers');
        }
        const numberValue = Number(value);
        if (!Number.isSafeInteger(numberValue)) {
            throw new Error('Numeric filter values must be safe integers');
        }
        return numberValue;
    }

    if (field.type === 'date') {
        if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
            throw new Error('Date filter values must be dates, strings, or timestamps');
        }
        const dateValue = value instanceof Date ? value.getTime() : new Date(value).getTime();
        if (!Number.isFinite(dateValue)) throw new Error('Invalid date filter value');
        return dateValue;
    }

    if (typeof value !== 'string') throw new Error('String filter values must be strings');
    return field.normalize === 'lowercase' ? value.toLowerCase() : value;
}

export function validateOperatorValue(
    operator: string,
    value: unknown,
    field: TxFilterFieldDefinition,
): void {
    const definition = getTxFilterOperator(operator);

    if (
        ['gt', 'gte', 'lt', 'lte', 'between'].includes(operator) &&
        !['number', 'bigint', 'date'].includes(field.type)
    ) {
        throw new Error(`Operator "${operator}" is not supported for this field`);
    }
    if (operator === 'contains' && field.type !== 'string') {
        throw new Error('Operator "contains" is only supported for string fields');
    }

    if (definition.valueMode === 'set') {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`Operator "${operator}" requires a non-empty array value`);
        }
        if (value.length > MAX_FILTER_ARRAY_VALUES) {
            throw new Error(`Filter arrays cannot contain more than ${MAX_FILTER_ARRAY_VALUES} values`);
        }
        for (const item of value) normalizeTxFilterValue(item, field);
        return;
    }
    if (definition.valueMode === 'range') {
        if (!Array.isArray(value) || value.length !== 2) {
            throw new Error('Operator "between" requires an array with exactly two values');
        }
        normalizeTxFilterValue(value[0], field);
        normalizeTxFilterValue(value[1], field);
        return;
    }
    if (operator === 'contains' && typeof value !== 'string') {
        throw new Error('Operator "contains" requires a string value');
    }
    normalizeTxFilterValue(value, field);
}
