import { Op } from 'sequelize';
import Block from '../models/block';

export async function countCanonicalBlocksInRange(
    fromBlock: number,
    toBlock: number,
): Promise<number> {
    return Block.count({
        where: {
            status: 'CANONICAL',
            blockNumber: { [Op.gte]: fromBlock, [Op.lte]: toBlock },
        },
    });
}

export interface CanonicalBlockIdentity {
    blockNumber: number;
    blockHash: string;
    parentHash: string;
}

export async function findCanonicalBlockIdentity(
    blockNumber: number,
): Promise<CanonicalBlockIdentity | null> {
    const block = await Block.findOne({
        where: { blockNumber, status: 'CANONICAL' },
        attributes: ['blockNumber', 'blockHash', 'parentHash'],
    });
    if (!block) return null;
    return {
        blockNumber: block.blockNumber,
        blockHash: block.blockHash,
        parentHash: block.parentHash,
    };
}
