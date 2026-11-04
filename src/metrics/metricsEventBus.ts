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

export interface RpcOperationMetricEvent {
    operation: string;
    durationMs: number;
    attempts: number;
    retryCount: number;
    endpointFailovers: number;
    outcome: 'success' | 'failure';
}

type RpcMetricListener = (event: RpcMetricEventInput) => void;
type RpcOperationMetricListener = (event: RpcOperationMetricEvent) => void;

const rpcMetricListeners = new Set<RpcMetricListener>();
const rpcOperationMetricListeners = new Set<RpcOperationMetricListener>();

export function publishRpcMetricEvent(event: RpcMetricEventInput): void {
    for (const listener of rpcMetricListeners) listener(event);
}

export function subscribeToRpcMetricEvents(listener: RpcMetricListener): () => void {
    rpcMetricListeners.add(listener);
    return () => rpcMetricListeners.delete(listener);
}

export function publishRpcOperationMetricEvent(event: RpcOperationMetricEvent): void {
    for (const listener of rpcOperationMetricListeners) listener(event);
}

export function subscribeToRpcOperationMetricEvents(
    listener: RpcOperationMetricListener,
): () => void {
    rpcOperationMetricListeners.add(listener);
    return () => rpcOperationMetricListeners.delete(listener);
}
