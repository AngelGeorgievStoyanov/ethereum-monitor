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
    TIMEOUT: [504],
    PROVIDER: [502, 503],
} as const;

export const RPC_ERROR_JSON_CODES = {
    RATE_LIMIT: [-32005],
} as const;

export const RPC_ERROR_MESSAGE_PATTERNS = {
    RATE_LIMIT: [
        /rate[\s_-]*limit/i,
        /too many requests/i,
        /request limit exceeded/i,
        /quota exceeded/i,
        /throughput limit/i,
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
    ],
    RPC: [
        /json.?rpc/i,
        /execution reverted/i,
        /invalid params/i,
        /method not found/i,
    ],
} as const;

export const RPC_ERROR_MAX_NESTED_DEPTH = 6;
