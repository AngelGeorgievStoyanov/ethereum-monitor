import { createHash } from 'node:crypto';
import type { TxFilterRule } from '../types/tx-filter.types';

export function createTxFilterRuleSignature(rule: TxFilterRule): string {
    return createHash('sha256').update(JSON.stringify(rule)).digest('hex');
}
