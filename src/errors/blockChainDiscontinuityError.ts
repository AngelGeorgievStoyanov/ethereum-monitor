export class BlockChainDiscontinuityError extends Error {
    constructor(
        public readonly blockNumber: number,
        message: string,
    ) {
        super(message);
        this.name = 'BlockChainDiscontinuityError';
    }
}
