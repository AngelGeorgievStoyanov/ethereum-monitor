import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

interface TxMatchAttributes {
    id: number;
    txId: number;
    txFilterId: number;
}

type TxMatchCreationAttributes = Optional<TxMatchAttributes, 'id'>;

class TxMatch extends Model<TxMatchAttributes, TxMatchCreationAttributes> implements TxMatchAttributes {
    public id!: number;
    public txId!: number;
    public txFilterId!: number;
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
            allowNull: false,
            references: { model: 'TxFilters', key: 'id' },
            onDelete: 'CASCADE',
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
