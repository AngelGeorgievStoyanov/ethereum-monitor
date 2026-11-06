import { Response } from 'express';
import { ValidationError } from './validationError';

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

    if (error instanceof ValidationError) {
        res.status(400).json({ message: error.message });
        return;
    }

    const details = error instanceof Error ? error.message : String(error);
    console.error(`[HTTP] ${message}: ${details}`);
    res.status(500).json({ message });
}
