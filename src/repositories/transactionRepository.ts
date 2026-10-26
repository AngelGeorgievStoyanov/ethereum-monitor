import Transaction, { TransactionCreationAttributes } from '../models/transaction';
import TxFilter from '../models/txFilter';
import TxMatch from '../models/txMatch';

export async function findOrCreateTransfer(data: TransactionCreationAttributes) {
    const [transaction] = await Transaction.findOrCreate({
        where: {
            txHash: data.txHash,
            transferType: data.transferType,
            ...(data.transferType === 'erc20' ? { logIndex: data.logIndex } : {}),
        },
        defaults: data,
    });

    return transaction;
}

export async function findOrCreateInternalTransfer(data: TransactionCreationAttributes) {
    const where = {
        txHash: data.txHash,
        transferType: 'internal' as const,
        from: data.from,
        to: data.to ?? null,
        value: data.value,
        tokenAddress: data.tokenAddress ?? null,
    };
    const existing = await Transaction.findOne({ where });

    if (existing) {
        await existing.increment('internalCount');
        await existing.reload();
        return existing;
    }

    return Transaction.create({
        ...data,
        transferType: 'internal',
        internalCount: 1,
    });
}

export async function createTxMatches(txId: number, txFilterIds: number[]) {
    if (txFilterIds.length === 0) return;

    await TxMatch.bulkCreate(
        txFilterIds.map((txFilterId) => ({ txId, txFilterId })),
        { ignoreDuplicates: true },
    );
}

export function findAllTransactions() {
    return Transaction.findAll({
        include: [
            {
                model: TxMatch,
                as: 'matches',
                include: [{ model: TxFilter, as: 'txFilter' }],
            },
        ],
    });
}

export function deleteTransactionById(id: number) {
    return Transaction.destroy({ where: { id } });
}
