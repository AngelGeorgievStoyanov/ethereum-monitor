import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

interface TxFilterAttributes {
    id: number;
    description: string;
    from?: string | null;
    to?: string | null;
    isActive: boolean;
    activeFromBlock: number | null;
}

export type TxFilterCreationAttributes = Optional<TxFilterAttributes, 'id' | 'isActive'>;

class TxFilter
    extends Model<TxFilterAttributes, TxFilterCreationAttributes>
    implements TxFilterAttributes
{
    public id!: number;
    public description!: string;
    public from?: string | null;
    public to?: string | null;
    public isActive!: boolean;
    public activeFromBlock!: number | null;
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
        from: {
            type: DataTypes.STRING(42),
            allowNull: true,
        },
        to: {
            type: DataTypes.STRING(42),
            allowNull: true,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        activeFromBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
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
