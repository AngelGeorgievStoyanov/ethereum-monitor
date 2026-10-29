import { Op, Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../database';
import Transaction, { TransactionCreationAttributes } from '../models/transaction';
import TxFilter from '../models/txFilter';
import { getTxFilterService } from '../services/txFilterService';
import TxMatch from '../models/txMatch';

export interface TransferBatchItem {
    data: TransactionCreationAttributes;
    matchingTxFilterIds: number[];
}

function getTransferIdentity(data: {
    txHash: string;
    transferType: string;
    logIndex: number;
    blockHash: string;
}): string {
    const blockHash = data.blockHash.toLowerCase();
    return data.transferType === 'erc20'
        ? `${data.txHash.toLowerCase()}:erc20:${data.logIndex}:${blockHash}`
        : `${data.txHash.toLowerCase()}:${data.transferType}:${blockHash}`;
}

export async function createTransfersBatch(
    items: readonly TransferBatchItem[],
    transaction?: SequelizeTransaction,
    reconcileMatches = false,
): Promise<void> {
    if (items.length === 0) return;

    const persist = async (dbTransaction: SequelizeTransaction) => {
        const data = items.map((item) => item.data);
        const identityConditions = [
            ...new Map(
                data.map((item) => {
                    const identity = getTransferIdentity(item);
                    return [
                        identity,
                        {
                            txHash: item.txHash,
                            transferType: item.transferType,
                            blockHash: item.blockHash,
                            ...(item.transferType === 'erc20' ? { logIndex: item.logIndex } : {}),
                        },
                    ] as const;
                }),
            ).values(),
        ];
        const lookup = {
            where: { [Op.or]: identityConditions },
            transaction: dbTransaction,
        };
        const existingTransactions = await Transaction.findAll(lookup);
        const existingIdentities = new Set(existingTransactions.map(getTransferIdentity));
        const itemsToPersist = reconcileMatches
            ? items.filter(
                  (item) =>
                      item.matchingTxFilterIds.length > 0 ||
                      existingIdentities.has(getTransferIdentity(item.data)),
              )
            : items;
        const insertedTransactions =
            itemsToPersist.length === 0
                ? []
                : await Transaction.bulkCreate(
                      itemsToPersist.map((item) => item.data),
                      {
                          ignoreDuplicates: true,
                          returning: true,
                          transaction: dbTransaction,
                      },
                  );
        const transactionsByIdentity = new Map<string, Transaction>();
        for (const storedTransaction of existingTransactions) {
            transactionsByIdentity.set(getTransferIdentity(storedTransaction), storedTransaction);
        }
        for (const insertedTransaction of insertedTransactions) {
            transactionsByIdentity.set(
                getTransferIdentity(insertedTransaction),
                insertedTransaction,
            );
        }

        // Normally the first lookup plus PostgreSQL RETURNING resolves every row.
        // Keep a targeted fallback for a concurrent insert between lookup and bulkCreate.
        const unresolvedItems = itemsToPersist.filter(
            (item) => !transactionsByIdentity.has(getTransferIdentity(item.data)),
        );
        if (unresolvedItems.length > 0) {
            const unresolvedConditions = [
                ...new Map(
                    unresolvedItems.map((item) => {
                        const data = item.data;
                        return [
                            getTransferIdentity(data),
                            {
                                txHash: data.txHash,
                                transferType: data.transferType,
                                blockHash: data.blockHash,
                                ...(data.transferType === 'erc20'
                                    ? { logIndex: data.logIndex }
                                    : {}),
                            },
                        ] as const;
                    }),
                ).values(),
            ];
            const unresolvedTransactions = await Transaction.findAll({
                where: { [Op.or]: unresolvedConditions },
                transaction: dbTransaction,
            });
            for (const storedTransaction of unresolvedTransactions) {
                transactionsByIdentity.set(
                    getTransferIdentity(storedTransaction),
                    storedTransaction,
                );
            }
        }

        const filterIds = [...new Set(itemsToPersist.flatMap((item) => item.matchingTxFilterIds))];
        if (filterIds.length === 0 && !reconcileMatches) return;

        // Filter descriptions are part of the active in-memory cache; avoid querying TxFilter for each batch.
        const descriptionsById = new Map<number, string>(
            getTxFilterService()
                .getTxFilters()
                .map((filter) => [filter.id, filter.description] as const),
        );
        const matches: Array<{
            txId: number;
            txFilterId: number;
            txFilterDescription: string;
        }> = [];

        for (const item of itemsToPersist) {
            const storedTransaction = transactionsByIdentity.get(getTransferIdentity(item.data));
            if (!storedTransaction) {
                throw new Error(
                    `Unable to resolve stored transfer ${item.data.txHash} (${item.data.transferType}) after batch insert`,
                );
            }

            for (const filterId of item.matchingTxFilterIds) {
                const description = descriptionsById.get(filterId);
                if (description === undefined) continue;
                matches.push({
                    txId: storedTransaction.id,
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

        if (reconcileMatches) {
            const txIds = [
                ...new Set(
                    itemsToPersist
                        .map(
                            (item) =>
                                transactionsByIdentity.get(getTransferIdentity(item.data))?.id,
                        )
                        .filter((id): id is number => id !== undefined),
                ),
            ];
            const existingMatches =
                txIds.length === 0
                    ? []
                    : await TxMatch.findAll({
                          where: { txId: { [Op.in]: txIds } },
                          transaction: dbTransaction,
                      });
            const matchingFilterIdsByTxId = new Map<number, Set<number>>();
            for (const item of itemsToPersist) {
                const storedTransaction = transactionsByIdentity.get(
                    getTransferIdentity(item.data),
                );
                if (!storedTransaction) continue;
                matchingFilterIdsByTxId.set(
                    storedTransaction.id,
                    new Set(item.matchingTxFilterIds.filter((id) => descriptionsById.has(id))),
                );
            }

            const updatesByGroup = new Map<
                string,
                {
                    ids: number[];
                    matchStatus: 'ACTIVE' | 'NOT_MATCHED';
                    txFilterDescription?: string;
                }
            >();
            for (const match of existingMatches) {
                if (match.matchStatus === 'FILTER_DELETED' || match.txFilterId === null) continue;
                const isMatching =
                    matchingFilterIdsByTxId.get(match.txId)?.has(match.txFilterId) ?? false;
                const description = isMatching ? descriptionsById.get(match.txFilterId) : undefined;
                const matchStatus = isMatching ? 'ACTIVE' : 'NOT_MATCHED';
                const key = `${matchStatus}:${match.txFilterId}:${description ?? ''}`;
                const group: {
                    ids: number[];
                    matchStatus: 'ACTIVE' | 'NOT_MATCHED';
                    txFilterDescription?: string;
                } = updatesByGroup.get(key) ?? {
                    ids: [],
                    matchStatus,
                    ...(description !== undefined ? { txFilterDescription: description } : {}),
                };
                group.ids.push(match.id);
                updatesByGroup.set(key, group);
            }

            for (const group of updatesByGroup.values()) {
                await TxMatch.update(
                    {
                        matchStatus: group.matchStatus,
                        ...(group.txFilterDescription !== undefined
                            ? { txFilterDescription: group.txFilterDescription }
                            : {}),
                    },
                    {
                        where: { id: { [Op.in]: group.ids } },
                        transaction: dbTransaction,
                    },
                );
            }
        }
    };

    if (transaction) {
        await persist(transaction);
        return;
    }

    await sequelize.transaction(persist);
}

export async function findOrCreateTransfer(data: TransactionCreationAttributes) {
    const [transaction] = await Transaction.findOrCreate({
        where: {
            txHash: data.txHash,
            transferType: data.transferType,
            blockHash: data.blockHash,
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
        blockHash: data.blockHash,
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

    const filters = await getTxFilterService().getAllTxFilters();
    const descriptionsById = new Map<number, string>(
        filters
            .filter(
                (filter) =>
                    txFilterIds.includes(filter.id) && typeof filter.description === 'string',
            )
            .map((filter) => [filter.id, filter.description] as const),
    );

    await TxMatch.bulkCreate(
        [...descriptionsById.entries()].map(([txFilterId, description]) => ({
            txId,
            txFilterId,
            txFilterDescription: description,
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
