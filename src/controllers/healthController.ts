import { Request, Response } from 'express';
import { getReadinessResult } from '../services/healthService';
import { mapHealthReadinessResponse } from '../mappers/healthMapper';

export const getLiveness = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
};

export const getReadiness = async (_req: Request, res: Response): Promise<void> => {
    const result = await getReadinessResult();
    res.status(result.ready ? 200 : 503).json(mapHealthReadinessResponse(result));
};
