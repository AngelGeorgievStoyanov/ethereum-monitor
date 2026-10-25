import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';
import Transaction from './transaction';

interface TxFilterAttributes {
    id: string;
    name: string;
    senderAddress?: string | null;
    recipientAddress?: string | null;
    isActive: boolean;
}

type TxFilterCreationAttributes = Optional<TxFilterAttributes, 'id' | 'isActive'>;

class TxFilter
    extends Model<TxFilterAttributes, TxFilterCreationAttributes>
    implements TxFilterAttributes
{
    public id!: string;
    public name!: string;
    public senderAddress?: string | null;
    public recipientAddress?: string | null;
    public isActive!: boolean;

    public static associate() {
        this.hasMany(Transaction, { foreignKey: 'txFilterId' });
    }
}

TxFilter.init(
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
        tableName: 'TxFilters',
        modelName: 'TxFilter',
        timestamps: true,
    },
);

export default TxFilter;
