import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';
import type { TxFilterRule } from '../types/tx-filter.types';

interface TxFilterAttributes {
    id: number;
    description: string;
    isActive: boolean;
    rule: TxFilterRule;
}

export type TxFilterCreationAttributes = Optional<TxFilterAttributes, 'id' | 'isActive'>;

class TxFilter
    extends Model<TxFilterAttributes, TxFilterCreationAttributes>
    implements TxFilterAttributes
{
    public id!: number;
    public description!: string;
    public isActive!: boolean;
    public rule!: TxFilterRule;
}

TxFilter.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        description: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        rule: {
            type: DataTypes.JSONB,
            allowNull: false,
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
