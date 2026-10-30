import { MAX_FILTER_ARRAY_VALUES } from '../constants/tx-filter.constants';
import type { TxFilterFieldDefinition, TxFilterOperatorName } from './txFilterRegistry';
import { getTxFilterOperator } from './txFilterRegistry';

export function normalizeTxFilterValue(value: unknown, field: TxFilterFieldDefinition): unknown {
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
    if (!field.operators.includes(operator as TxFilterOperatorName)) {
        throw new Error(`Operator "${operator}" is not supported for this field`);
    }

    const definition = getTxFilterOperator(operator);

    if (definition.valueMode === 'set') {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`Operator "${operator}" requires a non-empty array value`);
        }
        if (value.length > MAX_FILTER_ARRAY_VALUES) {
            throw new Error(
                `Filter arrays cannot contain more than ${MAX_FILTER_ARRAY_VALUES} values`,
            );
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

    normalizeTxFilterValue(value, field);
}
