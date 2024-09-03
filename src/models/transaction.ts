import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';
import Configuration from './configuration';

interface TransactionAttributes {
    id: string;
    configurationId: string;
    hash: string;
    nonce: number;
    blockHash: string;
    blockNumber: number;
    transactionIndex: number;
    from: string;
    to?: string;
    value: string;
    gas: number;
    gasPrice: string;
    input?: string;
    status?: string;
    transactionType?: string;
    contractAddress?: string;
    timestamp?: Date;
    requiredConfirmations?: number;
    gasLimit?: number;
    maxPriorityFeePerGas?: string;
    maxFeePerGas?: string;
    maxFeePerBlobGas?: string;
    accessList?: string;
    blobVersionedHashes?: string;
    logsBloom?: string;
    gasUsed?: number;
    cumulativeGasUsed?: number;
    root?: string;
    blobGasUsed?: number;
}

interface TransactionCreationAttributes extends Optional<TransactionAttributes, 'id'> { }

class Transaction extends Model<TransactionAttributes, TransactionCreationAttributes>
    implements TransactionAttributes {
    public id!: string;
    public configurationId!: string;
    public hash!: string;
    public nonce!: number;
    public blockHash!: string;
    public blockNumber!: number;
    public transactionIndex!: number;
    public from!: string;
    public to?: string;
    public value!: string;
    public gas!: number;
    public gasPrice!: string;
    public input?: string;
    public status?: string;
    public transactionType?: string;
    public contractAddress?: string;
    public timestamp?: Date;
    public requiredConfirmations?: number;
    public gasLimit?: number;
    public maxPriorityFeePerGas?: string;
    public maxFeePerGas?: string;
    public maxFeePerBlobGas?: string;
    public accessList?: string;
    public blobVersionedHashes?: string;
    public logsBloom?: string;
    public gasUsed?: number;
    public cumulativeGasUsed?: number;
    public root?: string;
    public blobGasUsed?: number;

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
        gas: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        gasPrice: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        input: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.STRING,
        },
        transactionType: {
            type: DataTypes.STRING,
        },
        contractAddress: {
            type: DataTypes.STRING,
        },
        timestamp: {
            type: DataTypes.DATE,
        },
        requiredConfirmations: {
            type: DataTypes.INTEGER,
        },
        gasLimit: {
            type: DataTypes.INTEGER,
        },
        maxPriorityFeePerGas: {
            type: DataTypes.STRING,
        },
        maxFeePerGas: {
            type: DataTypes.STRING,
        },
        maxFeePerBlobGas: {
            type: DataTypes.STRING,
        },
        accessList: {
            type: DataTypes.TEXT,
        },
        blobVersionedHashes: {
            type: DataTypes.TEXT,
        },
        logsBloom: {
            type: DataTypes.STRING,
        },
        gasUsed: {
            type: DataTypes.INTEGER,
        },
        cumulativeGasUsed: {
            type: DataTypes.INTEGER,
        },
        root: {
            type: DataTypes.STRING,
        },
        blobGasUsed: {
            type: DataTypes.INTEGER,
        },
    },
    {
        sequelize,
        tableName: 'Transaction',
        modelName: 'Transaction',
        timestamps: true
    }
);

export default Transaction;
