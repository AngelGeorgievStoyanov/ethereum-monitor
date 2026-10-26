import { Request, Response } from 'express';
import sequelize from '../database';
import { ethereumProvider } from '../services/ethereumRpcService';

export const getLiveness = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
};

export const getReadiness = async (_req: Request, res: Response): Promise<void> => {
    const [databaseCheck, rpcCheck] = await Promise.allSettled([
        sequelize.authenticate(),
        ethereumProvider.getBlock('finalized'),
    ]);

    const databaseAvailable = databaseCheck.status === 'fulfilled';
    const rpcAvailable = rpcCheck.status === 'fulfilled' && rpcCheck.value !== null;
    const ready = databaseAvailable && rpcAvailable;

    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        checks: {
            database: databaseAvailable,
            rpc: rpcAvailable,
        },
    });
};
