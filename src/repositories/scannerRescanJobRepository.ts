import { Op } from 'sequelize';
import ScannerRescanJob from '../models/scannerRescanJob';
import type { ScannerRescanJobSummary } from '../types/scanner-status.types';

function toSummary(job: ScannerRescanJob): ScannerRescanJobSummary {
    return {
        id: job.id,
        fromBlock: job.fromBlock,
        toBlock: job.toBlock,
        currentBlock: job.currentBlock,
        blocksProcessed: job.blocksProcessed,
        status: job.status,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
    };
}

export async function findLatestScannerRescanJob(): Promise<ScannerRescanJobSummary | null> {
    const job = await ScannerRescanJob.findOne({ order: [['createdAt', 'DESC']] });
    return job ? toSummary(job) : null;
}

export async function findActiveScannerRescanJob(): Promise<ScannerRescanJobSummary | null> {
    const job = await ScannerRescanJob.findOne({
        where: { status: { [Op.in]: ['QUEUED', 'RUNNING'] } },
    });
    return job ? toSummary(job) : null;
}

export async function findScannerRescanJobById(
    id: string,
): Promise<ScannerRescanJobSummary | null> {
    const job = await ScannerRescanJob.findByPk(id);
    return job ? toSummary(job) : null;
}

export async function markActiveScannerRescanJobsInterrupted(): Promise<number> {
    const [updatedRows] = await ScannerRescanJob.update(
        {
            status: 'INTERRUPTED',
            error: 'Scanner ownership was lost before the rescan operation completed',
            completedAt: new Date(),
        },
        { where: { status: { [Op.in]: ['QUEUED', 'RUNNING'] } } },
    );
    return updatedRows;
}

export async function createScannerRescanJob(input: {
    id: string;
    fromBlock: number;
    toBlock: number;
}): Promise<ScannerRescanJobSummary> {
    const job = await ScannerRescanJob.create({
        ...input,
        currentBlock: input.fromBlock,
        blocksProcessed: 0,
        status: 'QUEUED',
        error: null,
        startedAt: null,
        completedAt: null,
    });
    return toSummary(job);
}

export async function updateScannerRescanJob(
    id: string,
    updates: Partial<
        Pick<
            ScannerRescanJobSummary,
            'status' | 'currentBlock' | 'blocksProcessed' | 'error' | 'startedAt' | 'completedAt'
        >
    >,
): Promise<ScannerRescanJobSummary | null> {
    const job = await ScannerRescanJob.findByPk(id);
    if (!job) return null;
    await job.update(updates);
    return toSummary(job);
}
