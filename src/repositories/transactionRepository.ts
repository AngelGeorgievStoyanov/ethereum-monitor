import { QueryTypes } from 'sequelize';
import sequelize from '../database';
import Transaction, { TransactionCreationAttributes } from '../models/transaction';

const TRANSFER_UNIQUE_INDEX = 'transactions_transfer_identity_unique';

interface DuplicateTransfer {
    configurationId: string;
    hash: string;
    transferType: 'native' | 'erc20';
    logIndex: number;
    count: number;
}

export async function ensureTransferUniqueness() {
    const duplicateGroups = await sequelize.query<DuplicateTransfer>(
        `SELECT "configurationId", "hash", "transferType", "logIndex", COUNT(*) AS "count"
         FROM "Transactions"
         GROUP BY "configurationId", "hash", "transferType", "logIndex"
         HAVING COUNT(*) > 1
         LIMIT 10`,
        { type: QueryTypes.SELECT },
    );

    if (duplicateGroups.length > 0) {
        const examples = duplicateGroups
            .map(
                ({ configurationId, hash, transferType, logIndex, count }) =>
                    `configurationId=${configurationId}, hash=${hash}, type=${transferType}, logIndex=${logIndex}, count=${count}`,
            )
            .join('; ');

        throw new Error(
            `Cannot enforce transfer uniqueness because duplicate records already exist.  +
            `Resolve these records manually, then restart. Duplicate examples: ${examples}`,
        );
    }

    const queryInterface = sequelize.getQueryInterface();
    const indexes = await queryInterface.showIndex('Transactions');
    if (indexes.some((index) => index.name === TRANSFER_UNIQUE_INDEX)) return;

    await queryInterface.addIndex(
        'Transactions',
        ['configurationId', 'hash', 'transferType', 'logIndex'],
        {
            name: TRANSFER_UNIQUE_INDEX,
            unique: true,
        },
    );
}

export async function findOrCreateTransfer(data: TransactionCreationAttributes) {
    const [transaction] = await Transaction.findOrCreate({
        where: {
            configurationId: data.configurationId,
            hash: data.hash,
            transferType: data.transferType,
            logIndex: data.logIndex,
        },
        defaults: data,
    });

    return transaction;
}

export function findAllTransactions() {
    return Transaction.findAll();
}

export function deleteTransactionById(id: string) {
    return Transaction.destroy({ where: { id } });
}
