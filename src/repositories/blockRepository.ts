import { Op } from 'sequelize';
import Block from '../models/block';

export async function countCanonicalBlocksInRange(fromBlock: number, toBlock: number): Promise<number> {
    return Block.count({
        where: {
            status: 'CANONICAL',
            blockNumber: { [Op.gte]: fromBlock, [Op.lte]: toBlock },
        },
    });
}
