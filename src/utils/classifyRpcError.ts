import {
    RPC_ERROR_CATEGORIES,
    RPC_ERROR_CODE_KEYS,
    RPC_ERROR_HTTP_STATUS,
    RPC_ERROR_HTTP_STATUS_RANGE,
    RPC_ERROR_JSON_CODES,
    RPC_ERROR_JSON_CODE_RANGE,
    RPC_ERROR_MAX_NESTED_DEPTH,
    RPC_ERROR_MESSAGE_KEYS,
    RPC_ERROR_MESSAGE_PATTERNS,
    RPC_ERROR_NESTED_KEYS,
    RPC_ERROR_STATUS_KEYS,
} from '../constants/rpc-error.constants';

export type RpcErrorCategory =
    (typeof RPC_ERROR_CATEGORIES)[keyof typeof RPC_ERROR_CATEGORIES];

export interface RpcErrorClassification {
    category: RpcErrorCategory;
    retryable: boolean;
    httpStatus: number | null;
    rpcCode: number | null;
    message: string;
}

type ErrorDetails = {
    messages: string[];
    httpStatuses: number[];
    rpcCodes: number[];
};

function addNumericValue(target: number[], value: unknown): void {
    if (typeof value !== 'number' && typeof value !== 'string') return;
    if (String(value).trim() === '') return;
    const numericValue = Number(value);
    if (Number.isInteger(numericValue)) target.push(numericValue);
}

function collectErrorDetails(error: unknown): ErrorDetails {
    const details: ErrorDetails = { messages: [], httpStatuses: [], rpcCodes: [] };
    const visited = new Set<object>();
    const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current.depth > RPC_ERROR_MAX_NESTED_DEPTH) continue;
        const value = current.value;
        if (value === null || value === undefined) continue;

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) continue;
            details.messages.push(trimmed);

            const httpStatusMatch = trimmed.match(
                /\b(?:HTTP(?: status)?|status(?: code)?|response)\s*[:=]?\s*(\d{3})\b/i,
            );
            if (httpStatusMatch) addNumericValue(details.httpStatuses, httpStatusMatch[1]);

            const rpcCodeMatch = trimmed.match(/\bcode\s*[:=]?\s*(-\d{4,5})\b/i);
            if (rpcCodeMatch) addNumericValue(details.rpcCodes, rpcCodeMatch[1]);

            if (
                (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
                current.depth < RPC_ERROR_MAX_NESTED_DEPTH
            ) {
                try {
                    queue.push({ value: JSON.parse(trimmed), depth: current.depth + 1 });
                } catch {
                    // Keep the original text when it is not valid JSON.
                }
            }
            continue;
        }

        if (typeof value !== 'object') {
            details.messages.push(String(value));
            continue;
        }

        if (visited.has(value)) continue;
        visited.add(value);

        if (Array.isArray(value)) {
            for (const item of value) {
                queue.push({ value: item, depth: current.depth + 1 });
            }
            continue;
        }

        const record = value as Record<string, unknown>;

        for (const key of RPC_ERROR_MESSAGE_KEYS) {
            if (typeof record[key] !== 'string') continue;
            const messageValue = (record[key] as string).trim();
            details.messages.push(messageValue);
            if (
                current.depth < RPC_ERROR_MAX_NESTED_DEPTH &&
                (messageValue.startsWith('{') || messageValue.startsWith('['))
            ) {
                queue.push({ value: messageValue, depth: current.depth + 1 });
            }
        }

        for (const key of RPC_ERROR_STATUS_KEYS) {
            addNumericValue(details.httpStatuses, record[key]);
        }

        for (const key of RPC_ERROR_CODE_KEYS) {
            const numericCode: number[] = [];
            addNumericValue(numericCode, record[key]);
            for (const code of numericCode) {
                if (
                    code >= RPC_ERROR_JSON_CODE_RANGE.MIN &&
                    code <= RPC_ERROR_JSON_CODE_RANGE.MAX
                ) {
                    details.rpcCodes.push(code);
                } else if (
                    code >= RPC_ERROR_HTTP_STATUS_RANGE.MIN &&
                    code <= RPC_ERROR_HTTP_STATUS_RANGE.MAX
                ) {
                    details.httpStatuses.push(code);
                }
            }
        }

        for (const key of RPC_ERROR_NESTED_KEYS) {
            if (record[key] !== undefined && record[key] !== value) {
                queue.push({ value: record[key], depth: current.depth + 1 });
            }
        }
    }

    return details;
}

export function classifyRpcError(error: unknown): RpcErrorClassification {
    const details = collectErrorDetails(error);
    const message = details.messages.join(' | ').slice(0, 1000);
    const normalized = message.toLowerCase();
    const hasPattern = (patterns: readonly RegExp[]) =>
        patterns.some((pattern) => pattern.test(normalized));

    let category: RpcErrorCategory = RPC_ERROR_CATEGORIES.UNKNOWN;

    if (
        details.httpStatuses.some((status) =>
            RPC_ERROR_HTTP_STATUS.RATE_LIMIT.includes(status as 429),
        ) ||
        details.rpcCodes.some((code) =>
            RPC_ERROR_JSON_CODES.RATE_LIMIT.includes(code as -32005),
        ) ||
        hasPattern(RPC_ERROR_MESSAGE_PATTERNS.RATE_LIMIT)
    ) {
        category = RPC_ERROR_CATEGORIES.RATE_LIMIT;
    } else if (
        details.httpStatuses.some((status) =>
            RPC_ERROR_HTTP_STATUS.TIMEOUT.includes(status as 408 | 504),
        ) ||
        hasPattern(RPC_ERROR_MESSAGE_PATTERNS.TIMEOUT)
    ) {
        category = RPC_ERROR_CATEGORIES.TIMEOUT;
    } else if (hasPattern(RPC_ERROR_MESSAGE_PATTERNS.NETWORK)) {
        category = RPC_ERROR_CATEGORIES.NETWORK;
    } else if (
        details.httpStatuses.some((status) =>
            RPC_ERROR_HTTP_STATUS.PROVIDER.includes(status as 500 | 502 | 503),
        ) ||
        hasPattern(RPC_ERROR_MESSAGE_PATTERNS.PROVIDER)
    ) {
        category = RPC_ERROR_CATEGORIES.PROVIDER;
    } else if (
        details.rpcCodes.length > 0 ||
        hasPattern(RPC_ERROR_MESSAGE_PATTERNS.RPC)
    ) {
        category = RPC_ERROR_CATEGORIES.RPC;
    }

    const retryable =
        category === RPC_ERROR_CATEGORIES.RATE_LIMIT ||
        category === RPC_ERROR_CATEGORIES.TIMEOUT ||
        category === RPC_ERROR_CATEGORIES.NETWORK ||
        category === RPC_ERROR_CATEGORIES.PROVIDER;

    return {
        category,
        retryable,
        httpStatus: details.httpStatuses[0] ?? null,
        rpcCode: details.rpcCodes[0] ?? null,
        message: message || 'Unknown RPC error',
    };
}
