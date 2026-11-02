import type { RpcErrorCategory } from '../utils/classifyRpcError';

export interface RpcMetricEventInput {
    method: string;
    endpointIndex: number;
    durationMs: number;
    outcome: 'success' | 'failure';
    message?: string;
    retryable?: boolean;
    errorCategory?: RpcErrorCategory;
    httpStatus?: number | null;
    rpcCode?: number | null;
}

type RpcMetricListener = (event: RpcMetricEventInput) => void;

const rpcMetricListeners = new Set<RpcMetricListener>();

export function publishRpcMetricEvent(event: RpcMetricEventInput): void {
    for (const listener of rpcMetricListeners) listener(event);
}

export function subscribeToRpcMetricEvents(listener: RpcMetricListener): () => void {
    rpcMetricListeners.add(listener);
    return () => rpcMetricListeners.delete(listener);
}
