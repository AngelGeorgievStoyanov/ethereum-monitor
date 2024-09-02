import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';



export enum MonitoringMode {
    Blocks = 'blocks',
    Pending = 'pending',
}

interface ConfigurationAttributes {
    id: string;
    name: string;
    senderAddress?: string;
    recipientAddress?: string;
    minAmount?: string;
    maxAmount?: string;
    exactAmount?: string;
    eventType?: string;
    blockNumber?: number;
    gasPrice?: string;
    gasLimit?: string;
    status?: string;
    contractAddress?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gas?: string;
    nonce?: string;
    value?: string;
    transactionType?: string;
    minTimestamp?: number;
    maxTimestamp?: number;
    inputData?: string;
    accessList?: string;
    blobVersionedHashes?: string;
    isActive?: boolean;
    monitoringMode?: MonitoringMode;
    requiredConfirmations?: number;
}

interface ConfigurationCreationAttributes extends Optional<ConfigurationAttributes, 'id'> { }

class Configuration extends Model<ConfigurationAttributes, ConfigurationCreationAttributes>
    implements ConfigurationAttributes {
    public id!: string;
    public name!: string;
    public senderAddress?: string;
    public recipientAddress?: string;
    public minAmount?: string;
    public maxAmount?: string;
    public exactAmount?: string;
    public eventType?: string;
    public blockNumber?: number;
    public gasPrice?: string;
    public gasLimit?: string;
    public status?: string;
    public contractAddress?: string;
    public maxFeePerGas?: string;
    public maxPriorityFeePerGas?: string;
    public gas?: string;
    public nonce?: string;
    public value?: string;
    public transactionType?: string;
    public minTimestamp?: number;
    public maxTimestamp?: number;
    public inputData?: string;
    public accessList?: string;
    public blobVersionedHashes?: string;
    public isActive?: boolean;
    public monitoringMode?: MonitoringMode;
    public requiredConfirmations?: number;
}

Configuration.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        senderAddress: {
            type: DataTypes.STRING,
        },
        recipientAddress: {
            type: DataTypes.STRING,
        },
        minAmount: {
            type: DataTypes.STRING,
        },
        maxAmount: {
            type: DataTypes.STRING,
        },
        exactAmount: {
            type: DataTypes.STRING,
        },
        eventType: {
            type: DataTypes.STRING,
        },
        blockNumber: {
            type: DataTypes.INTEGER,
        },
        gasPrice: {
            type: DataTypes.STRING,
        },
        gasLimit: {
            type: DataTypes.STRING,
        },
        status: {
            type: DataTypes.STRING,
        },
        contractAddress: {
            type: DataTypes.STRING,
        },
        maxFeePerGas: {
            type: DataTypes.STRING,
        },
        maxPriorityFeePerGas: {
            type: DataTypes.STRING,
        },
        gas: {
            type: DataTypes.STRING,
        },
        nonce: {
            type: DataTypes.STRING,
        },
        value: {
            type: DataTypes.STRING,
        },
        minTimestamp: {
            type: DataTypes.INTEGER,
        },
        maxTimestamp: {
            type: DataTypes.INTEGER,
        },
        inputData: {
            type: DataTypes.STRING,
        },
        accessList: {
            type: DataTypes.STRING,
        },
        blobVersionedHashes: {
            type: DataTypes.TEXT,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        monitoringMode: {
            type: DataTypes.ENUM(...Object.values(MonitoringMode)),
            allowNull: false,
            defaultValue: MonitoringMode.Blocks
        },
        requiredConfirmations: {
            type: DataTypes.INTEGER,
        },
    },
    {
        sequelize,
        tableName: 'Configurations',
        modelName: 'Configuration',
        timestamps: true
    }
);

export default Configuration;
