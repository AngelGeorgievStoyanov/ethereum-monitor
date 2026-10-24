import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';
import Transaction from './transaction';

interface ConfigurationAttributes {
    id: string;
    name: string;
    senderAddress?: string | null;
    recipientAddress?: string | null;
    isActive: boolean;
}

type ConfigurationCreationAttributes = Optional<ConfigurationAttributes, 'id' | 'isActive'>;

class Configuration
    extends Model<ConfigurationAttributes, ConfigurationCreationAttributes>
    implements ConfigurationAttributes
{
    public id!: string;
    public name!: string;
    public senderAddress?: string | null;
    public recipientAddress?: string | null;
    public isActive!: boolean;

    public static associate() {
        this.hasMany(Transaction, { foreignKey: 'configurationId' });
    }
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
            allowNull: true,
        },
        recipientAddress: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    },
    {
        sequelize,
        tableName: 'Configurations',
        modelName: 'Configuration',
        timestamps: true,
    },
);

export default Configuration;
