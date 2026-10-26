import { Op } from 'sequelize';
import sequelize from '../database';
import Transaction, { TransactionCreationAttributes } from '../models/transaction';
import TxFilter from '../models/txFilter';
import TxMatch from '../models/txMatch';

export interface TransferBatchItem {
    data: TransactionCreationAttributes;
    matchingTxFilterIds: number[];
}

function getTransferIdentity(data: {
    txHash: string;
    transferType: string;
    logIndex: number;
}): string {
    return data.transferType === 'erc20'
        ? `${data.txHash.toLowerCase()}:erc20:${data.logIndex}`
        : `${data.txHash.toLowerCase()}:${data.transferType}`;
}

export async function createTransfersBatch(items: readonly TransferBatchItem[]): Promise<void> {
    if (items.length === 0) return;

    await sequelize.transaction(async (dbTransaction) => {
        const data = items.map((item) => item.data);
        await Transaction.bulkCreate(data, {
            ignoreDuplicates: true,
            transaction: dbTransaction,
        });

        const txHashes = [...new Set(data.map((item) => item.txHash))];
        const transferTypes = [...new Set(data.map((item) => item.transferType))];
        const storedTransactions = await Transaction.findAll({
            where: {
                txHash: { [Op.in]: txHashes },
                transferType: { [Op.in]: transferTypes },
            },
            transaction: dbTransaction,
        });
        const transactionsByIdentity = new Map(
            storedTransactions.map((transaction) => [
                getTransferIdentity(transaction),
                transaction,
            ]),
        );

        const filterIds = [
            ...new Set(items.flatMap((item) => item.matchingTxFilterIds)),
        ];
        if (filterIds.length === 0) return;

        const filters = await TxFilter.findAll({
            where: { id: { [Op.in]: filterIds } },
            attributes: ['id', 'description'],
            transaction: dbTransaction,
        });
        const descriptionsById = new Map(filters.map((filter) => [filter.id, filter.description]));
        const matches: Array<{
            txId: number;
            txFilterId: number;
            txFilterDescription: string;
        }> = [];

        for (const item of items) {
            const transaction = transactionsByIdentity.get(getTransferIdentity(item.data));
            if (!transaction) {
                throw new Error(
                    `Unable to resolve stored transfer ${item.data.txHash} (${item.data.transferType}) after batch insert`,
                );
            }

            for (const filterId of item.matchingTxFilterIds) {
                const description = descriptionsById.get(filterId);
                if (description === undefined) continue;
                matches.push({
                    txId: transaction.id,
                    txFilterId: filterId,
                    txFilterDescription: description,
                });
            }
        }

        if (matches.length > 0) {
            await TxMatch.bulkCreate(matches, {
                ignoreDuplicates: true,
                transaction: dbTransaction,
            });
        }
    });
}

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

    const filters = await TxFilter.findAll({
        where: { id: { [Op.in]: txFilterIds } },
        attributes: ['id', 'description'],
    });

    await TxMatch.bulkCreate(
        filters.map((filter) => ({
            txId,
            txFilterId: filter.id,
            txFilterDescription: filter.description,
        })),
        { ignoreDuplicates: true },
    );
}

export async function findTransactionsPage(page: number, limit: number) {
    const result = await Transaction.findAndCountAll({
        include: [
            {
                model: TxMatch,
                as: 'matches',
                include: [{ model: TxFilter, as: 'txFilter' }],
            },
        ],
        distinct: true,
        order: [
            ['blockNumber', 'DESC'],
            ['transactionIndex', 'DESC'],
            ['id', 'DESC'],
        ],
        limit,
        offset: (page - 1) * limit,
    });

    return {
        items: result.rows,
        pagination: {
            page,
            limit,
            total: result.count,
            totalPages: Math.ceil(result.count / limit),
        },
    };
}

export function deleteTransactionById(id: number) {
    return Transaction.destroy({ where: { id } });
}
