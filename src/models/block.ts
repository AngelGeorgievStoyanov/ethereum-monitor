import { DataTypes, Model } from 'sequelize';
import sequelize from '../database';

export type BlockStatus = 'CANONICAL' | 'REORGED';

interface BlockAttributes {
    id: number;
    blockNumber: number;
    blockHash: string;
    parentHash: string;
    status: BlockStatus;
}

class Block extends Model<BlockAttributes> implements BlockAttributes {
    public id!: number;
    public blockNumber!: number;
    public blockHash!: string;
    public parentHash!: string;
    public status!: BlockStatus;
}

Block.init(
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        blockNumber: { type: DataTypes.INTEGER, allowNull: false },
        blockHash: { type: DataTypes.STRING(66), allowNull: false },
        parentHash: { type: DataTypes.STRING(66), allowNull: false },
        status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'CANONICAL' },
    },
    {
        sequelize,
        tableName: 'Blocks',
        modelName: 'Block',
        timestamps: true,
        indexes: [
            { name: 'blocks_block_hash_unique', unique: true, fields: ['blockHash'] },
            { name: 'blocks_canonical_height_unique', unique: true, fields: ['blockNumber'], where: { status: 'CANONICAL' } },
            { name: 'blocks_number_status_index', fields: ['blockNumber', 'status'] },
        ],
    },
);

export default Block;
