import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

interface TxMatchAttributes {
    id: number;
    txId: number;
    txFilterId: number | null;
    txFilterDescription: string | null;
}

type TxMatchCreationAttributes = Optional<TxMatchAttributes, 'id' | 'txFilterDescription'>;

class TxMatch
    extends Model<TxMatchAttributes, TxMatchCreationAttributes>
    implements TxMatchAttributes
{
    public id!: number;
    public txId!: number;
    public txFilterId!: number | null;
    public txFilterDescription!: string | null;
}

TxMatch.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        txId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Transactions', key: 'id' },
            onDelete: 'CASCADE',
        },
        txFilterId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'TxFilters', key: 'id' },
            onDelete: 'SET NULL',
        },
        txFilterDescription: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'TxMatches',
        modelName: 'TxMatch',
        timestamps: true,
        indexes: [
            {
                name: 'tx_matches_tx_filter_unique',
                unique: true,
                fields: ['txId', 'txFilterId'],
            },
        ],
    },
);

export default TxMatch;
