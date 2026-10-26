import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

export type TxFilterGroupLogic = 'AND' | 'OR';

interface TxFilterGroupAttributes {
    id: number;
    txFilterId: number;
    parentGroupId: number | null;
    logic: TxFilterGroupLogic;
}

type TxFilterGroupCreationAttributes = Optional<TxFilterGroupAttributes, 'id' | 'parentGroupId'>;

class TxFilterGroup
    extends Model<TxFilterGroupAttributes, TxFilterGroupCreationAttributes>
    implements TxFilterGroupAttributes
{
    public id!: number;
    public txFilterId!: number;
    public parentGroupId!: number | null;
    public logic!: TxFilterGroupLogic;
}

TxFilterGroup.init(
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        txFilterId: { type: DataTypes.INTEGER, allowNull: false },
        parentGroupId: { type: DataTypes.INTEGER, allowNull: true },
        logic: { type: DataTypes.ENUM('AND', 'OR'), allowNull: false, defaultValue: 'AND' },
    },
        indexes: [
            { name: 'tx_filter_groups_filter_id_idx', fields: ['txFilterId'] },
            { name: 'tx_filter_groups_parent_id_idx', fields: ['parentGroupId'] },
        ],
    },
);

export default TxFilterGroup;
