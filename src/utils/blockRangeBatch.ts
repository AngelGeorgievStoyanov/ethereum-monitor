export type BlockRangeDirection = 'forward' | 'backward';

export interface BlockRangeBatchOptions {
    fromBlock: number;
    toBlock: number;
    batchSize: number;
    direction: BlockRangeDirection;
}

export interface BlockRangeBatch {
    fromBlock: number;
    toBlock: number;
}

export function* iterateBlockRangeBatches({
    fromBlock,
    toBlock,
    batchSize,
    direction,
}: BlockRangeBatchOptions): Generator<BlockRangeBatch> {
    if (
        !Number.isSafeInteger(fromBlock) ||
        !Number.isSafeInteger(toBlock) ||
        fromBlock < 0 ||
        toBlock < fromBlock ||
        !Number.isSafeInteger(batchSize) ||
        batchSize < 1
    ) {
        throw new Error('Invalid block range batch options');
    }

    if (direction === 'forward') {
        for (let start = fromBlock; start <= toBlock; start += batchSize) {
            yield {
                fromBlock: start,
                toBlock: Math.min(start + batchSize - 1, toBlock),
            };
        }
        return;
    }

    for (let end = toBlock; end >= fromBlock; end -= batchSize) {
        yield {
            fromBlock: Math.max(end - batchSize + 1, fromBlock),
            toBlock: end,
        };
    }
}
