export function formatError(error: unknown): string {
    const value = error as {
        shortMessage?: unknown;
        reason?: unknown;
        code?: unknown;
        message?: unknown;
    };
    const rawMessage =
        typeof value?.shortMessage === 'string'
            ? value.shortMessage
            : typeof value?.reason === 'string'
              ? value.reason
              : typeof value?.message === 'string'
                ? value.message
                : error instanceof Error
                  ? error.message
                  : String(error);
    const message = rawMessage.length > 240 ? `${rawMessage.slice(0, 240)}…` : rawMessage;
    const code = typeof value?.code === 'string' ? ` (${value.code})` : '';
    return `${message}${code}`;
}
