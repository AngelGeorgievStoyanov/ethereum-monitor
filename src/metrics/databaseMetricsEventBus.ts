export interface DatabaseMetricEvent {
    operation: 'read' | 'write' | 'other';
    queryType: string;
    durationMs: number;
}

type DatabaseMetricListener = (event: DatabaseMetricEvent) => void;
const listeners = new Set<DatabaseMetricListener>();

export function publishDatabaseMetricEvent(event: DatabaseMetricEvent): void {
    for (const listener of listeners) listener(event);
}

export function subscribeToDatabaseMetricEvents(listener: DatabaseMetricListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
