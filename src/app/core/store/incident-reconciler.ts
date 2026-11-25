import {
  Incident,
  IncidentFilterState,
  IncidentMetrics,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEntry,
  OptimisticActionKind,
  OptimisticMutation,
  TelemetryEvent,
} from '../models/incident.model';

const MAX_TIMELINE_ENTRIES = 25;

const SEVERITY_WEIGHT: Readonly<Record<IncidentSeverity, number>> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/**
 * Bounded FIFO Set that prevents unbounded heap growth during sustained 1,000 events/sec bursts.
 * JavaScript Set preserves insertion order, allowing O(1) lookup and O(1) oldest-entry eviction.
 */
export class BoundedEventIdSet {
  private readonly ids = new Set<string>();

  constructor(private readonly maxCapacity = 50_000) {}

  has(eventId: string): boolean {
    return this.ids.has(eventId);
  }

  add(eventId: string): void {
    if (this.ids.has(eventId)) {
      return;
    }
    if (this.ids.size >= this.maxCapacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) {
        this.ids.delete(oldest);
      }
    }
    this.ids.add(eventId);
  }

  get size(): number {
    return this.ids.size;
  }

  clear(): void {
    this.ids.clear();
  }
}

export interface BatchReconciliationResult {
  readonly incidentsById: Map<string, Incident>;
  readonly inFlightMutations: Map<string, OptimisticMutation>;
  readonly mutated: boolean;
  readonly acceptedCount: number;
  readonly duplicatesDropped: number;
  readonly outOfOrderReconciled: number;
}

function mergeMetrics(current: IncidentMetrics, patch?: Partial<IncidentMetrics>): IncidentMetrics {
  if (!patch) {
    return current;
  }
  return {
    errorRatePct: patch.errorRatePct ?? current.errorRatePct,
    p99LatencyMs: patch.p99LatencyMs ?? current.p99LatencyMs,
    affectedRps: patch.affectedRps ?? current.affectedRps,
  };
}

function insertTimelineOrdered(
  existing: readonly IncidentTimelineEntry[],
  entry: IncidentTimelineEntry,
): readonly IncidentTimelineEntry[] {
  const combined = [...existing, entry];
  combined.sort((a, b) => {
    if (b.sequence !== a.sequence) {
      return b.sequence - a.sequence;
    }
    return b.timestamp - a.timestamp;
  });
  return combined.slice(0, MAX_TIMELINE_ENTRIES);
}

function applyForwardTelemetryToIncident(existing: Incident, event: TelemetryEvent): Incident {
  const nextStatus = event.payload.status ?? existing.status;
  const nextSeverity = event.payload.severity ?? existing.severity;
  const nextAssignee =
    event.payload.assignee !== undefined ? event.payload.assignee : existing.assignee;

  const acknowledgedAt =
    existing.acknowledgedAt ??
    (nextStatus === 'Investigating' || nextStatus === 'Resolved' ? event.timestamp : null);

  const resolvedAt =
    nextStatus === 'Resolved' ? (existing.resolvedAt ?? event.timestamp) : existing.resolvedAt;

  const entry: IncidentTimelineEntry = {
    id: event.eventId,
    timestamp: event.timestamp,
    sequence: event.sequence,
    actor: event.payload.actor ?? 'telemetry-bus',
    summary: event.payload.summary,
    kind: 'telemetry-update',
  };

  return {
    ...existing,
    title: event.payload.title ?? existing.title,
    service: event.payload.service ?? existing.service,
    region: event.payload.region ?? existing.region,
    severity: nextSeverity,
    status: nextStatus,
    assignee: nextAssignee,
    updatedAt: Math.max(existing.updatedAt, event.timestamp),
    acknowledgedAt,
    resolvedAt,
    lastSequence: event.sequence,
    metrics: mergeMetrics(existing.metrics, event.payload.metrics),
    tags: event.payload.tags ?? existing.tags,
    timeline: [entry, ...existing.timeline].slice(0, MAX_TIMELINE_ENTRIES),
  };
}

function createIncidentFromEvent(event: TelemetryEvent): Incident {
  const status = event.payload.status ?? 'Open';
  const entry: IncidentTimelineEntry = {
    id: event.eventId,
    timestamp: event.timestamp,
    sequence: event.sequence,
    actor: event.payload.actor ?? 'telemetry-ingest',
    summary: event.payload.summary,
    kind: 'ingested',
  };

  return {
    id: event.incidentId,
    title: event.payload.title ?? `Anomalous latency detected on ${event.incidentId}`,
    service: event.payload.service ?? 'core-gateway',
    region: event.payload.region ?? 'us-east-1',
    severity: event.payload.severity ?? 'Medium',
    status,
    assignee: event.payload.assignee ?? null,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    acknowledgedAt: status === 'Investigating' ? event.timestamp : null,
    resolvedAt: status === 'Resolved' ? event.timestamp : null,
    lastSequence: event.sequence,
    pendingAction: null,
    metrics: {
      errorRatePct: event.payload.metrics?.errorRatePct ?? 1.4,
      p99LatencyMs: event.payload.metrics?.p99LatencyMs ?? 420,
      affectedRps: event.payload.metrics?.affectedRps ?? 310,
    },
    tags: event.payload.tags ?? ['live-stream'],
    timeline: [entry],
  };
}

/**
 * Reconciles a 100ms buffered batch of telemetry events against current incident state:
 * 1. Drops duplicate `eventId`s in O(1).
 * 2. Reconciles out-of-order sequence arrivals (`event.sequence <= existing.lastSequence`)
 *    without regressing newer entity state.
 * 3. Preserves active optimistic operator overlays while updating underlying `serverBaseline`
 *    so subsequent rollbacks restore fresh telemetry metrics.
 */
export function reconcileTelemetryBatch(
  currentMap: ReadonlyMap<string, Incident>,
  currentInFlight: ReadonlyMap<string, OptimisticMutation>,
  seenIds: BoundedEventIdSet,
  batch: readonly TelemetryEvent[],
): BatchReconciliationResult {
  if (batch.length === 0) {
    return {
      incidentsById: new Map(currentMap),
      inFlightMutations: new Map(currentInFlight),
      mutated: false,
      acceptedCount: 0,
      duplicatesDropped: 0,
      outOfOrderReconciled: 0,
    };
  }

  const nextMap = new Map<string, Incident>(currentMap);
  const nextInFlight = new Map<string, OptimisticMutation>(currentInFlight);

  let mutated = false;
  let acceptedCount = 0;
  let duplicatesDropped = 0;
  let outOfOrderReconciled = 0;

  for (const event of batch) {
    if (seenIds.has(event.eventId)) {
      duplicatesDropped++;
      continue;
    }
    seenIds.add(event.eventId);

    const existing = nextMap.get(event.incidentId);

    if (!existing) {
      nextMap.set(event.incidentId, createIncidentFromEvent(event));
      acceptedCount++;
      mutated = true;
      continue;
    }

    // Out-of-order check: causal sequence is older than or equal to already-applied sequence
    if (event.sequence <= existing.lastSequence) {
      const auditEntry: IncidentTimelineEntry = {
        id: event.eventId,
        timestamp: event.timestamp,
        sequence: event.sequence,
        actor: event.payload.actor ?? 'telemetry-reconciler',
        summary: `[Out-of-order seq #${event.sequence}] ${event.payload.summary}`,
        kind: 'reconciled-out-of-order',
      };

      const reconciledIncident: Incident = {
        ...existing,
        timeline: insertTimelineOrdered(existing.timeline, auditEntry),
      };
      nextMap.set(event.incidentId, reconciledIncident);

      const activeMutation = nextInFlight.get(event.incidentId);
      if (activeMutation) {
        nextInFlight.set(event.incidentId, {
          ...activeMutation,
          serverBaseline: {
            ...activeMutation.serverBaseline,
            timeline: insertTimelineOrdered(activeMutation.serverBaseline.timeline, auditEntry),
          },
        });
      }

      outOfOrderReconciled++;
      acceptedCount++;
      mutated = true;
      continue;
    }

    // Forward sequence progression
    const activeMutation = nextInFlight.get(event.incidentId);
    if (activeMutation) {
      // Advance authoritative server baseline so rollback won't discard concurrent stream telemetry
      const updatedBaseline = applyForwardTelemetryToIncident(
        activeMutation.serverBaseline,
        event,
      );
      nextInFlight.set(event.incidentId, {
        ...activeMutation,
        serverBaseline: updatedBaseline,
      });

      // Keep operator's optimistic status/assignee/pendingAction intact while refreshing live telemetry metrics
      nextMap.set(event.incidentId, {
        ...existing,
        severity: updatedBaseline.severity,
        metrics: updatedBaseline.metrics,
        lastSequence: updatedBaseline.lastSequence,
        updatedAt: Math.max(existing.updatedAt, event.timestamp),
        timeline: [updatedBaseline.timeline[0], ...existing.timeline].slice(
          0,
          MAX_TIMELINE_ENTRIES,
        ),
      });
    } else {
      nextMap.set(event.incidentId, applyForwardTelemetryToIncident(existing, event));
    }

    acceptedCount++;
    mutated = true;
  }

  return {
    incidentsById: nextMap,
    inFlightMutations: nextInFlight,
    mutated,
    acceptedCount,
    duplicatesDropped,
    outOfOrderReconciled,
  };
}

export function buildOptimisticIncident(
  incident: Incident,
  action: OptimisticActionKind,
  actor: string,
  assignee: string | null,
  now: number,
): Incident {
  let nextStatus: IncidentStatus = incident.status;
  let nextAssignee: string | null = incident.assignee;
  let nextAckAt = incident.acknowledgedAt;
  let nextResolvedAt = incident.resolvedAt;
  let actionLabel = '';

  switch (action) {
    case 'acknowledge':
      nextStatus = incident.status === 'Resolved' ? 'Resolved' : 'Investigating';
      nextAckAt = incident.acknowledgedAt ?? now;
      nextAssignee = incident.assignee ?? actor;
      actionLabel = `Acknowledged incident (optimistic)`;
      break;
    case 'assign':
      nextAssignee = assignee;
      if (incident.status === 'Open') {
        nextStatus = 'Investigating';
        nextAckAt = incident.acknowledgedAt ?? now;
      }
      actionLabel = `Assigned incident to ${assignee ?? 'Unassigned'} (optimistic)`;
      break;
    case 'resolve':
      nextStatus = 'Resolved';
      nextAckAt = incident.acknowledgedAt ?? now;
      nextResolvedAt = now;
      actionLabel = `Marked incident Resolved (optimistic)`;
      break;
  }

  const optimisticEntry: IncidentTimelineEntry = {
    id: `opt-${incident.id}-${now}`,
    timestamp: now,
    sequence: incident.lastSequence + 1,
    actor,
    summary: actionLabel,
    kind: 'operator-action',
  };

  return {
    ...incident,
    status: nextStatus,
    assignee: nextAssignee,
    acknowledgedAt: nextAckAt,
    resolvedAt: nextResolvedAt,
    updatedAt: now,
    pendingAction: action,
    timeline: [optimisticEntry, ...incident.timeline].slice(0, MAX_TIMELINE_ENTRIES),
  };
}

export function filterAndSortIncidents(
  incidents: readonly Incident[],
  filter: IncidentFilterState,
): readonly Incident[] {
  const hasSeverityFilter = filter.severities.length > 0 && filter.severities.length < 4;
  const severitySet = hasSeverityFilter ? new Set(filter.severities) : null;

  const hasStatusFilter = filter.statuses.length > 0 && filter.statuses.length < 3;
  const statusSet = hasStatusFilter ? new Set(filter.statuses) : null;

  const normalizedQuery = filter.searchQuery.trim().toLowerCase();
  const hasSearch = normalizedQuery.length > 0;

  const filtered: Incident[] = [];

  for (let i = 0; i < incidents.length; i++) {
    const item = incidents[i];

    if (severitySet !== null && !severitySet.has(item.severity)) {
      continue;
    }

    if (statusSet !== null && !statusSet.has(item.status)) {
      continue;
    }

    if (hasSearch) {
      const matches =
        item.id.toLowerCase().includes(normalizedQuery) ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.service.toLowerCase().includes(normalizedQuery) ||
        item.region.toLowerCase().includes(normalizedQuery) ||
        (item.assignee !== null && item.assignee.toLowerCase().includes(normalizedQuery)) ||
        item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));

      if (!matches) {
        continue;
      }
    }

    filtered.push(item);
  }

  const dirMultiplier = filter.sortDirection === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    let comparison = 0;
    switch (filter.sortBy) {
      case 'severity':
        comparison = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
        if (comparison === 0) {
          comparison = a.updatedAt - b.updatedAt;
        }
        break;
      case 'createdAt':
        comparison = a.createdAt - b.createdAt;
        break;
      case 'p99LatencyMs':
        comparison = a.metrics.p99LatencyMs - b.metrics.p99LatencyMs;
        break;
      case 'updatedAt':
      default:
        comparison = a.updatedAt - b.updatedAt;
        break;
    }

    if (comparison !== 0) {
      return comparison * dirMultiplier;
    }
    return a.id.localeCompare(b.id);
  });

  return filtered;
}
