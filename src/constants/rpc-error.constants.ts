export const RPC_ERROR_CATEGORIES = {
    RATE_LIMIT: 'rateLimit',
    TIMEOUT: 'timeout',
    NETWORK: 'network',
    PROVIDER: 'provider',
    RPC: 'rpc',
    UNKNOWN: 'unknown',
} as const;

export const RPC_ERROR_HTTP_STATUS = {
    RATE_LIMIT: [429],
    TIMEOUT: [408, 504],
    PROVIDER: [500, 502, 503],
} as const;

export const RPC_ERROR_JSON_CODES = {
    RATE_LIMIT: [-32005],
} as const;

export const RPC_ERROR_JSON_CODE_RANGE = {
    MIN: -32768,
    MAX: -32000,
} as const;

export const RPC_ERROR_HTTP_STATUS_RANGE = {
    MIN: 100,
    MAX: 599,
} as const;

export const RPC_ERROR_MESSAGE_KEYS = [
    'message',
    'reason',
    'shortMessage',
    'statusText',
    'error_description',
    'description',
] as const;

export const RPC_ERROR_STATUS_KEYS = [
    'status',
    'statusCode',
    'status_code',
    'httpStatus',
    'http_status',
] as const;

export const RPC_ERROR_CODE_KEYS = ['code', 'errorCode', 'error_code'] as const;

export const RPC_ERROR_NESTED_KEYS = [
    'cause',
    'error',
    'response',
    'data',
    'body',
    'result',
    'info',
    'details',
    'originalError',
    'payload',
] as const;

export const RPC_ERROR_MESSAGE_PATTERNS = {
    RATE_LIMIT: [
        /\b429\b/i,
        /rate[\s_-]*limit/i,
        /too many requests/i,
        /request limit exceeded/i,
        /quota exceeded/i,
        /throughput limit/i,
        /compute units?.*(capacity|limit|exceeded)/i,
        /requests? per second/i,
        /request quota/i,
        /daily request.*exceeded/i,
        /exceeded.*requests/i,
    ],
    TIMEOUT: [
        /timed?\s*out/i,
        /timeout/i,
        /deadline exceeded/i,
        /etimedout/i,
    ],
    NETWORK: [
        /econnreset/i,
        /econnrefused/i,
        /econnaborted/i,
        /enetunreach/i,
        /ehostunreach/i,
        /enotfound/i,
        /eai_again/i,
        /socket hang up/i,
        /network error/i,
        /connection.*(closed|reset|refused|lost)/i,
    ],
    PROVIDER: [
        /service unavailable/i,
        /bad gateway/i,
        /gateway timeout/i,
        /temporarily unavailable/i,
        /provider.*(unavailable|overloaded)/i,
        /upstream.*(error|unavailable)/i,
        /internal server error/i,
    ],
    RPC: [
        /json.?rpc/i,
        /execution reverted/i,
        /\brevert(?:ed)?\b/i,
        /invalid params/i,
        /method not found/i,
    ],
} as const;

export const RPC_ERROR_MAX_NESTED_DEPTH = 6;
