export type IncidentSeverity = 'Critical' | 'High' | 'Medium' | 'Low';

export type IncidentStatus = 'Open' | 'Investigating' | 'Resolved';

export type StreamRatePreset = 'Paused' | 'Normal' | 'Spike' | 'Burst';

export const STREAM_RATE_EVENTS_PER_SEC: Readonly<Record<StreamRatePreset, number>> = {
  Paused: 0,
  Normal: 5,
  Spike: 250,
  Burst: 1000,
};

export type ConnectionPhase = 'Connected' | 'Disconnected' | 'Reconnecting';

export interface ConnectionState {
  readonly phase: ConnectionPhase;
  readonly attempt: number;
  readonly nextRetryInMs: number;
  readonly currentBackoffDelayMs: number;
  readonly disconnectedAt: number | null;
  readonly lastConnectedAt: number | null;
  readonly reason: string | null;
}

export type OptimisticActionKind = 'acknowledge' | 'assign' | 'resolve';

export interface IncidentMetrics {
  readonly errorRatePct: number;
  readonly p99LatencyMs: number;
  readonly affectedRps: number;
}

export interface IncidentTimelineEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly sequence: number;
  readonly actor: string;
  readonly summary: string;
  readonly kind:
    | 'ingested'
    | 'telemetry-update'
    | 'operator-action'
    | 'reconciled-out-of-order'
    | 'rollback';
}

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly service: string;
  readonly region: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly assignee: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acknowledgedAt: number | null;
  readonly resolvedAt: number | null;
  readonly lastSequence: number;
  readonly pendingAction: OptimisticActionKind | null;
  readonly metrics: IncidentMetrics;
  readonly tags: readonly string[];
  readonly timeline: readonly IncidentTimelineEntry[];
}

export type TelemetryEventType =
  | 'INCIDENT_CREATED'
  | 'INCIDENT_UPDATED'
  | 'INCIDENT_ESCALATED'
  | 'HEARTBEAT_METRIC';

export interface TelemetryEventPayload {
  readonly title?: string;
  readonly service?: string;
  readonly region?: string;
  readonly severity?: IncidentSeverity;
  readonly status?: IncidentStatus;
  readonly assignee?: string | null;
  readonly metrics?: Partial<IncidentMetrics>;
  readonly tags?: readonly string[];
  readonly summary: string;
  readonly actor?: string;
}

export interface TelemetryEvent {
  readonly eventId: string;
  readonly incidentId: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly type: TelemetryEventType;
  readonly isSimulatedDuplicate?: boolean;
  readonly isSimulatedOutOfOrder?: boolean;
  readonly payload: TelemetryEventPayload;
}

export type IncidentSortField = 'updatedAt' | 'severity' | 'createdAt' | 'p99LatencyMs';
export type SortDirection = 'asc' | 'desc';

export interface IncidentFilterState {
  readonly severities: readonly IncidentSeverity[];
  readonly statuses: readonly IncidentStatus[];
  readonly searchQuery: string;
  readonly sortBy: IncidentSortField;
  readonly sortDirection: SortDirection;
}

export interface OptimisticMutation {
  readonly mutationId: string;
  readonly incidentId: string;
  readonly kind: OptimisticActionKind;
  /**
   * Authoritative baseline snapshot prior to optimistic overlay.
   * Updated if valid forward stream telemetry arrives while the HTTP request is in flight,
   * ensuring rollback restores fresh server metrics instead of stale snapshots.
   */
  readonly serverBaseline: Incident;
  readonly startedAt: number;
}

export interface ThroughputSnapshot {
  readonly rawEventsPerSec: number;
  readonly renderBatchesPerSec: number;
  readonly avgBatchSize: number;
  readonly uiFps: number;
  readonly totalEventsProcessed: number;
  readonly duplicatesDropped: number;
  readonly outOfOrderReconciled: number;
  readonly rollbacksTriggered: number;
}
