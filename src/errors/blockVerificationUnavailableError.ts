export class BlockVerificationUnavailableError extends Error {
    constructor(
        public readonly blockNumber: number,
        public readonly operation: string,
        message: string,
    ) {
        super(message);
        this.name = 'BlockVerificationUnavailableError';
    }
}
