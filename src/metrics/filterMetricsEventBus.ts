export interface FilterMetricEvent {
    filterId: number;
    durationMs: number;
    matched: boolean;
    failed: boolean;
}

type FilterMetricListener = (event: FilterMetricEvent) => void;
const listeners = new Set<FilterMetricListener>();

export function publishFilterMetricEvent(event: FilterMetricEvent): void {
    for (const listener of listeners) listener(event);
}

export function subscribeToFilterMetricEvents(listener: FilterMetricListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
