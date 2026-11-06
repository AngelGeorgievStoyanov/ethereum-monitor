import type { ManualRescanRequestResult } from '../services/manualRescanRequestService';

export function getManualRescanHttpStatus(result: ManualRescanRequestResult): number {
    if (result.kind === 'started') return 202;
    switch (result.reason) {
        case 'bad-request':
            return 400;
        case 'conflict':
            return 409;
        case 'unavailable':
            return 503;
    }
}

export function mapManualRescanResponse(result: ManualRescanRequestResult) {
    if (result.kind === 'rejected') return result.body;
    return {
        message: 'Manual rescan started',
        operationId: result.operationId,
        status: result.status,
        fromBlock: result.fromBlock,
        toBlock: result.toBlock,
        statusUrl: `/api/scanner/rescan/${result.operationId}`,
    };
}
