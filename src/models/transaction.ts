import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

export type TransferType = 'native' | 'erc20' | 'internal';

interface TransactionAttributes {
    id: number;
    txHash: string;
    transferType: TransferType;
    tokenAddress?: string | null;
    logIndex: number;
    nonce: number;
    blockHash: string;
    blockNumber: number;
    transactionIndex: number;
    from: string;
    to?: string | null;
    value: string;
    internalCount: number;
    status?: string;
    transactionType?: string;
    timestamp?: Date;
}

export type TransactionCreationAttributes = Optional<
    TransactionAttributes,
    'id' | 'tokenAddress' | 'to' | 'internalCount' | 'status' | 'transactionType' | 'timestamp'
>;

class Transaction
    extends Model<TransactionAttributes, TransactionCreationAttributes>
    implements TransactionAttributes
{
    public id!: number;
    public txHash!: string;
    public transferType!: TransferType;
    public tokenAddress?: string | null;
    public logIndex!: number;
    public nonce!: number;
    public blockHash!: string;
    public blockNumber!: number;
    public transactionIndex!: number;
    public from!: string;
    public to?: string | null;
    public value!: string;
    public internalCount!: number;
    public status?: string;
    public transactionType?: string;
    public timestamp?: Date;
}

Transaction.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        txHash: {
            type: DataTypes.STRING(66),
            allowNull: false,
        },
        transferType: {
            type: DataTypes.ENUM('native', 'erc20', 'internal'),
            allowNull: false,
        },
        tokenAddress: {
            type: DataTypes.STRING(42),
            allowNull: true,
        },
        logIndex: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: -1,
        },
        nonce: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        blockHash: {
            type: DataTypes.STRING(66),
            allowNull: false,
        },
        blockNumber: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        transactionIndex: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        from: {
            type: DataTypes.STRING(42),
            allowNull: false,
        },
        to: {
            type: DataTypes.STRING(42),
            allowNull: true,
        },
        value: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        internalCount: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
        },
        status: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        transactionType: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        timestamp: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'Transactions',
        modelName: 'Transaction',
        timestamps: true,
    },
);

export default Transaction;
