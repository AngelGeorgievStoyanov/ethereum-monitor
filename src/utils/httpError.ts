import { Response } from 'express';

export class HttpError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly details?: string,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export function sendHttpError(res: Response, message: string, error: unknown): void {
    if (error instanceof HttpError) {
        res.status(error.statusCode).json({
            message: error.message || message,
            ...(error.details ? { details: error.details } : {}),
        });
        return;
    }

    const details = error instanceof Error ? error.message : String(error);
    const isValidationError =
        /unsupported|requires|invalid|must have|must contain|must be|only supported|every filter group|at least one condition/i.test(
            details,
        );

    res.status(isValidationError ? 400 : 500).json({ message, details });
}
