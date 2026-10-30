import type { TxFilterRule } from '../types/tx-filter.types';
import { compileTxFilterRule } from './txFilterCompilerService';
import { ValidationError } from '../utils/validationError';

export function validateTxFilterRule(rule: TxFilterRule): void {
    try {
        compileTxFilterRule(rule);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ValidationError(message);
    }
}
