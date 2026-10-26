import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

interface TxFilterConditionAttributes {
    id: number;
    groupId: number;
    field: string;
    operator: string;
    value: unknown;
}

type TxFilterConditionCreationAttributes = Optional<TxFilterConditionAttributes, 'id'>;

class TxFilterCondition
    extends Model<TxFilterConditionAttributes, TxFilterConditionCreationAttributes>
    implements TxFilterConditionAttributes
{
    public id!: number;
    public groupId!: number;
    public field!: string;
    public operator!: string;
    public value!: unknown;
}

TxFilterCondition.init(
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        groupId: { type: DataTypes.INTEGER, allowNull: false },
        field: { type: DataTypes.STRING(80), allowNull: false },
        operator: { type: DataTypes.STRING(20), allowNull: false },
        value: { type: DataTypes.JSONB, allowNull: false },
    },
    { sequelize, tableName: 'TxFilterConditions', modelName: 'TxFilterCondition', timestamps: true },
);

export default TxFilterCondition;
