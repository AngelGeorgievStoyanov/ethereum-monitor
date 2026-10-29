import type { HealthReadinessResult } from '../services/healthService';

export interface HealthReadinessResponse {
    status: 'ready' | 'not_ready';
    checks: HealthReadinessResult['checks'];
}

export function mapHealthReadinessResponse(
    result: HealthReadinessResult,
): HealthReadinessResponse {
    return {
        status: result.ready ? 'ready' : 'not_ready',
        checks: result.checks,
    };
}
