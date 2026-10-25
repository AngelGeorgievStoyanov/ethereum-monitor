import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';
import Configuration from './configuration';

interface TransactionAttributes {
    id: string;
    configurationId: string;
    hash: string;
    transferType: 'native' | 'erc20';
    tokenAddress?: string;
    logIndex: number;
    nonce: number;
    blockHash: string;
    blockNumber: number;
    transactionIndex: number;
    from: string;
    to?: string;
    value: string;
    status?: string;
    transactionType?: string;
    timestamp?: Date;
}

export type TransactionCreationAttributes = Optional<TransactionAttributes, 'id'>;

class Transaction
    extends Model<TransactionAttributes, TransactionCreationAttributes>
    implements TransactionAttributes
{
    public id!: string;
    public configurationId!: string;
    public hash!: string;
    public transferType!: 'native' | 'erc20';
    public tokenAddress?: string;
    public logIndex!: number;
    public nonce!: number;
    public blockHash!: string;
    public blockNumber!: number;
    public transactionIndex!: number;
    public from!: string;
    public to?: string;
    public value!: string;
    public status?: string;
    public transactionType?: string;
    public timestamp?: Date;

    public static associate() {
        this.belongsTo(Configuration, { foreignKey: 'configurationId' });
    }
}

Transaction.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        configurationId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        hash: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        transferType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'native' },
        tokenAddress: { type: DataTypes.STRING, allowNull: true },
        logIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: -1 },
        nonce: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        blockHash: {
            type: DataTypes.STRING,
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
            type: DataTypes.STRING,
            allowNull: false,
        },
        to: {
            type: DataTypes.STRING,
        },
        value: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        status: {
            type: DataTypes.STRING,
        },
        transactionType: {
            type: DataTypes.STRING,
        },
        timestamp: {
            type: DataTypes.DATE,
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
