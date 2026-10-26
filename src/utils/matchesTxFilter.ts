import TxFilter from '../models/txFilter';

export function matchesTxFilter(
    from: string | null | undefined,
    to: string | null | undefined,
    txFilter: TxFilter,
): boolean {
    if (!txFilter.from && !txFilter.to) {
        return false;
    }

    const senderMatches = !txFilter.from || from?.toLowerCase() === txFilter.from.toLowerCase();
    const recipientMatches = !txFilter.to || to?.toLowerCase() === txFilter.to.toLowerCase();

    return senderMatches && recipientMatches;
}
