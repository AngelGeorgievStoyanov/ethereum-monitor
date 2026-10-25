import TxFilter from '../models/txFilter';

export function matchesTxFilter(
    from: string | null | undefined,
    to: string | null | undefined,
    config: TxFilter,
): boolean {
    if (!config.senderAddress && !config.recipientAddress) {
        return false;
    }

    const senderMatches =
        !config.senderAddress || from?.toLowerCase() === config.senderAddress.toLowerCase();
    const recipientMatches =
        !config.recipientAddress || to?.toLowerCase() === config.recipientAddress.toLowerCase();

    return senderMatches && recipientMatches;
}
