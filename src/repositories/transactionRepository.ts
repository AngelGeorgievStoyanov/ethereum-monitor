import { QueryTypes } from 'sequelize';
import sequelize from '../database';
import Transaction, { TransactionCreationAttributes } from '../models/transaction';
import TxMatch from '../models/txMatch';

const NATIVE_UNIQUE_INDEX = 'transactions_native_identity_unique';
const ERC20_UNIQUE_INDEX = 'transactions_erc20_identity_unique';

interface DuplicateNativeTransfer {
    txHash: string;
    count: number;
}

interface DuplicateErc20Transfer {
    txHash: string;
    logIndex: number;
    count: number;
}

export async function ensureTransferUniqueness() {
    const duplicateNativeTransfers = await sequelize.query<DuplicateNativeTransfer>(
        `SELECT "txHash", COUNT(*) AS "count"
         FROM "Transactions"
         WHERE "transferType" = 'native'
         GROUP BY "txHash"
         HAVING COUNT(*) > 1
         LIMIT 10`,
        { type: QueryTypes.SELECT },
    );

    const duplicateErc20Transfers = await sequelize.query<DuplicateErc20Transfer>(
        `SELECT "txHash", "logIndex", COUNT(*) AS "count"
         FROM "Transactions"
         WHERE "transferType" = 'erc20'
         GROUP BY "txHash", "logIndex"
         HAVING COUNT(*) > 1
         LIMIT 10`,
        { type: QueryTypes.SELECT },
    );

    if (duplicateNativeTransfers.length > 0 || duplicateErc20Transfers.length > 0) {
        const nativeExamples = duplicateNativeTransfers.map(
            ({ txHash, count }) => `native txHash=${txHash}, count=${count}`,
        );
        const erc20Examples = duplicateErc20Transfers.map(
            ({ txHash, logIndex, count }) =>
                `erc20 txHash=${txHash}, logIndex=${logIndex}, count=${count}`,
        );
        throw new Error(
            `Cannot enforce transfer uniqueness because duplicate records already exist: ${[...nativeExamples, ...erc20Examples].join('; ')}`,
        );
    }

    const queryInterface = sequelize.getQueryInterface();
    const indexes = (await queryInterface.showIndex('Transactions')) as Array<{ name?: string }>;

    if (!indexes.some((index) => index.name === NATIVE_UNIQUE_INDEX)) {
        await queryInterface.addIndex('Transactions', ['txHash', 'transferType'], {
            name: NATIVE_UNIQUE_INDEX,
            unique: true,
            where: { transferType: 'native' },
        });
    }

    if (!indexes.some((index) => index.name === ERC20_UNIQUE_INDEX)) {
        await queryInterface.addIndex('Transactions', ['txHash', 'transferType', 'logIndex'], {
            name: ERC20_UNIQUE_INDEX,
            unique: true,
            where: { transferType: 'erc20' },
        });
    }
}

export async function findOrCreateTransfer(data: TransactionCreationAttributes) {
    return Transaction.findOrCreate({
        where: {
            txHash: data.txHash,
            transferType: data.transferType,
            ...(data.transferType === 'erc20' ? { logIndex: data.logIndex } : {}),
        },
        defaults: data,
    }).then(([transaction]) => transaction);
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
    return Transaction.findAll();
}

export function deleteTransactionById(id: number) {
    return Transaction.destroy({ where: { id } });
}
