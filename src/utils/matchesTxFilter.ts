import TxFilter from '../models/txFilter';

export function matchesTxFilter(
    from: string | null | undefined,
    to: string | null | undefined,
    txFilter: TxFilter,
): boolean {
    if (!txFilter.senderAddress && !txFilter.recipientAddress) {
        return false;
    }

    const senderMatches =
        !txFilter.senderAddress || from?.toLowerCase() === txFilter.senderAddress.toLowerCase();
    const recipientMatches =
        !txFilter.recipientAddress || to?.toLowerCase() === txFilter.recipientAddress.toLowerCase();

    return senderMatches && recipientMatches;
}
