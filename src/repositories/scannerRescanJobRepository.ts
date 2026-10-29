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

export async function findScannerRescanJobById(id: string): Promise<ScannerRescanJobSummary | null> {
    const job = await ScannerRescanJob.findByPk(id);
    return job ? toSummary(job) : null;
}
