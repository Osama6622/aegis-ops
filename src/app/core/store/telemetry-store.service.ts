import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
   PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import {
  Incident,
  IncidentFilterState,
  IncidentSeverity,
  IncidentSortField,
  IncidentStatus,
  OptimisticActionKind,
  OptimisticMutation,
  SortDirection,
  TelemetryEvent,
  ThroughputSnapshot,
} from '../models/incident.model';
import { IncidentApiSimulatorService } from '../services/incident-api-simulator.service';
import { IncidentStreamSimulatorService } from '../services/incident-stream-simulator.service';
import { ToastService } from '../services/toast.service';
import {
  BoundedEventIdSet,
  buildOptimisticIncident,
  filterAndSortIncidents,
  reconcileTelemetryBatch,
} from './incident-reconciler';

const ALL_SEVERITIES: readonly IncidentSeverity[] = ['Critical', 'High', 'Medium', 'Low'];
const ALL_STATUSES: readonly IncidentStatus[] = ['Open', 'Investigating', 'Resolved'];

@Injectable({ providedIn: 'root' })
export class TelemetryStoreService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly streamSimulator = inject(IncidentStreamSimulatorService);
  private readonly apiSimulator = inject(IncidentApiSimulatorService);
  private readonly toastService = inject(ToastService);

  private readonly seenEventIds = new BoundedEventIdSet(50_000);
  private readonly inFlightMutations = new Map<string, OptimisticMutation>();
  private readonly searchInputSubject = new Subject<string>();

  private streamSubscription: Subscription | null = null;
  private searchSubscription: Subscription | null = null;
  private metricsSamplerTimer: ReturnType<typeof setInterval> | null = null;
  private rafHandle: number | null = null;

  private batchesInWindow = 0;
  private batchEventsInWindow = 0;
  private framesRenderedInWindow = 0;
  private mutationCounter = 1;

  // Primary state signals
  private readonly incidentMapState = signal<ReadonlyMap<string, Incident>>(new Map());
  private readonly selectedIncidentIdState = signal<string | null>(null);
  private readonly drawerOpenState = signal<boolean>(false);

  // Filter signals
  private readonly selectedSeveritiesState = signal<readonly IncidentSeverity[]>(ALL_SEVERITIES);
  private readonly selectedStatusesState = signal<readonly IncidentStatus[]>(ALL_STATUSES);
  private readonly rawSearchQueryState = signal<string>('');
  private readonly debouncedSearchQueryState = signal<string>('');
  private readonly sortByState = signal<IncidentSortField>('updatedAt');
  private readonly sortDirectionState = signal<SortDirection>('desc');

  // Telemetry & integrity counters
  private readonly throughputState = signal<ThroughputSnapshot>({
    rawEventsPerSec: 0,
    renderBatchesPerSec: 0,
    avgBatchSize: 0,
    uiFps: 60,
    totalEventsProcessed: 0,
    duplicatesDropped: 0,
    outOfOrderReconciled: 0,
    rollbacksTriggered: 0,
  });

  // Public read-only projections
  readonly selectedIncidentId = this.selectedIncidentIdState.asReadonly();
  readonly isDrawerOpen = this.drawerOpenState.asReadonly();
  readonly selectedSeverities = this.selectedSeveritiesState.asReadonly();
  readonly selectedStatuses = this.selectedStatusesState.asReadonly();
  readonly rawSearchQuery = this.rawSearchQueryState.asReadonly();
  readonly debouncedSearchQuery = this.debouncedSearchQueryState.asReadonly();
  readonly sortBy = this.sortByState.asReadonly();
  readonly sortDirection = this.sortDirectionState.asReadonly();
  readonly throughput = this.throughputState.asReadonly();

  readonly allIncidents = computed<readonly Incident[]>(() =>
    Array.from(this.incidentMapState().values()),
  );

  readonly totalIncidentCount = computed<number>(() => this.incidentMapState().size);

  readonly filterState = computed<IncidentFilterState>(() => ({
    severities: this.selectedSeveritiesState(),
    statuses: this.selectedStatusesState(),
    searchQuery: this.debouncedSearchQueryState(),
    sortBy: this.sortByState(),
    sortDirection: this.sortDirectionState(),
  }));

  /**
   * High-density filtered & sorted view bound to `@angular/cdk/scrolling` virtual viewport.
   */
  readonly filteredIncidents = computed<readonly Incident[]>(() =>
    filterAndSortIncidents(this.allIncidents(), this.filterState()),
  );

  readonly selectedIncident = computed<Incident | null>(() => {
    const id = this.selectedIncidentIdState();
    if (id === null) {
      return null;
    }
    return this.incidentMapState().get(id) ?? null;
  });

  /**
   * Live KPI: Active Critical incidents (`Critical` severity that are not yet `Resolved`).
   */
  readonly activeCriticalCount = computed<number>(() => {
    let count = 0;
    for (const incident of this.incidentMapState().values()) {
      if (incident.severity === 'Critical' && incident.status !== 'Resolved') {
        count++;
      }
    }
    return count;
  });

  /**
   * Live KPI: Mean Time to Acknowledge (MTTA) in milliseconds across all acknowledged incidents.
   */
  readonly meanTimeToAckMs = computed<number | null>(() => {
    let totalAckDelta = 0;
    let ackedCount = 0;

    for (const incident of this.incidentMapState().values()) {
      if (incident.acknowledgedAt !== null && incident.acknowledgedAt >= incident.createdAt) {
        totalAckDelta += incident.acknowledgedAt - incident.createdAt;
        ackedCount++;
      }
    }

    return ackedCount > 0 ? Math.round(totalAckDelta / ackedCount) : null;
  });

  constructor() {
    this.searchSubscription = this.searchInputSubject
      .pipe(debounceTime(180), distinctUntilChanged())
      .subscribe((query) => {
        this.debouncedSearchQueryState.set(query);
      });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  /**
   * Bootstraps the console with a 10,000+ seed dataset, connects the 100ms-buffered RxJS pipeline,
   * and starts live throughput + FPS telemetry sampling.
   */
  initializeConsole(seedCount = 10_000): void {
    this.seedIncidents(this.streamSimulator.generateSeedIncidents(seedCount));

    if (this.streamSubscription === null) {
      this.streamSubscription = this.streamSimulator.bufferedEvents$.subscribe((batch) => {
        this.ingestBatch(batch);
      });
    }

    this.streamSimulator.startEngine();
    this.startPerformanceSampler();
  }

  seedIncidents(incidents: readonly Incident[]): void {
    this.seenEventIds.clear();
    this.inFlightMutations.clear();
    const map = new Map<string, Incident>();
    for (const item of incidents) {
      map.set(item.id, item);
      for (const entry of item.timeline) {
        this.seenEventIds.add(entry.id);
      }
    }
    this.incidentMapState.set(map);
    if (incidents.length > 0 && this.selectedIncidentIdState() === null) {
      this.selectedIncidentIdState.set(incidents[0].id);
    }
  }

  /**
   * Commits a single buffered batch of TelemetryEvents in one atomic Signal update.
   */
  ingestBatch(batch: readonly TelemetryEvent[]): void {
    if (batch.length === 0) {
      return;
    }

    const result = reconcileTelemetryBatch(
      this.incidentMapState(),
      this.inFlightMutations,
      this.seenEventIds,
      batch,
    );

    this.inFlightMutations.clear();
    for (const [key, value] of result.inFlightMutations.entries()) {
      this.inFlightMutations.set(key, value);
    }

    if (result.mutated) {
      this.incidentMapState.set(result.incidentsById);
    }

    this.batchesInWindow++;
    this.batchEventsInWindow += batch.length;

    this.throughputState.update((prev) => ({
      ...prev,
      totalEventsProcessed: prev.totalEventsProcessed + result.acceptedCount,
      duplicatesDropped: prev.duplicatesDropped + result.duplicatesDropped,
      outOfOrderReconciled: prev.outOfOrderReconciled + result.outOfOrderReconciled,
    }));
  }

  // --- Filter & Selection Controls ---

  toggleSeverityFilter(severity: IncidentSeverity): void {
    this.selectedSeveritiesState.update((current) => {
      const exists = current.includes(severity);
      if (exists && current.length === 1) {
        return ALL_SEVERITIES;
      }
      return exists ? current.filter((item) => item !== severity) : [...current, severity];
    });
  }

  setSeverities(severities: readonly IncidentSeverity[]): void {
    this.selectedSeveritiesState.set(severities.length > 0 ? severities : ALL_SEVERITIES);
  }

  toggleStatusFilter(status: IncidentStatus): void {
    this.selectedStatusesState.update((current) => {
      const exists = current.includes(status);
      if (exists && current.length === 1) {
        return ALL_STATUSES;
      }
      return exists ? current.filter((item) => item !== status) : [...current, status];
    });
  }

  setStatuses(statuses: readonly IncidentStatus[]): void {
    this.selectedStatusesState.set(statuses.length > 0 ? statuses : ALL_STATUSES);
  }

  setSearchQuery(query: string, immediate = false): void {
    this.rawSearchQueryState.set(query);
    if (immediate) {
      this.debouncedSearchQueryState.set(query);
    } else {
      this.searchInputSubject.next(query);
    }
  }

  setSorting(sortBy: IncidentSortField, sortDirection?: SortDirection): void {
    if (sortDirection !== undefined) {
      this.sortByState.set(sortBy);
      this.sortDirectionState.set(sortDirection);
      return;
    }

    if (this.sortByState() === sortBy) {
      this.sortDirectionState.update((dir) => (dir === 'desc' ? 'asc' : 'desc'));
    } else {
      this.sortByState.set(sortBy);
      this.sortDirectionState.set('desc');
    }
  }

  resetFilters(): void {
    this.selectedSeveritiesState.set(ALL_SEVERITIES);
    this.selectedStatusesState.set(ALL_STATUSES);
    this.rawSearchQueryState.set('');
    this.debouncedSearchQueryState.set('');
    this.sortByState.set('updatedAt');
    this.sortDirectionState.set('desc');
  }

  selectIncident(incidentId: string | null, openDrawer = false): void {
    this.selectedIncidentIdState.set(incidentId);
    if (openDrawer && incidentId !== null) {
      this.drawerOpenState.set(true);
    }
  }

  openDetailDrawer(incidentId?: string): void {
    if (incidentId !== undefined) {
      this.selectedIncidentIdState.set(incidentId);
    }
    if (this.selectedIncidentIdState() !== null) {
      this.drawerOpenState.set(true);
    }
  }

  closeDetailDrawer(): void {
    this.drawerOpenState.set(false);
  }

  // --- Optimistic Operator Mutations & Rollback Reconciliation ---

  acknowledgeIncident(incidentId: string, actor = 'oncall.operator'): void {
    this.performOptimisticAction({ incidentId, action: 'acknowledge', actor });
  }

  assignIncident(incidentId: string, assignee: string, actor = 'oncall.operator'): void {
    this.performOptimisticAction({ incidentId, action: 'assign', assignee, actor });
  }

  resolveIncident(incidentId: string, actor = 'oncall.operator'): void {
    this.performOptimisticAction({ incidentId, action: 'resolve', actor });
  }

  private performOptimisticAction(params: {
    readonly incidentId: string;
    readonly action: OptimisticActionKind;
    readonly actor: string;
    readonly assignee?: string;
  }): void {
    const currentMap = this.incidentMapState();
    const currentIncident = currentMap.get(params.incidentId);
    if (!currentIncident || currentIncident.pendingAction !== null) {
      return;
    }

    const now = Date.now();
    const mutationId = `mut-${this.mutationCounter++}`;
    const targetAssignee =
      params.action === 'assign'
        ? (params.assignee ?? params.actor)
        : (currentIncident.assignee ?? params.actor);

    const mutation: OptimisticMutation = {
      mutationId,
      incidentId: params.incidentId,
      kind: params.action,
      serverBaseline: currentIncident,
      startedAt: now,
    };
    this.inFlightMutations.set(params.incidentId, mutation);

    // 1. Immediate (<1ms) optimistic Signal state update
    const optimisticIncident = buildOptimisticIncident(
      currentIncident,
      params.action,
      params.actor,
      targetAssignee,
      now,
    );

    const optimisticMap = new Map(currentMap);
    optimisticMap.set(params.incidentId, optimisticIncident);
    this.incidentMapState.set(optimisticMap);

    // 2. Execute simulated network call (300-800ms latency, ~15% failure rate)
    this.apiSimulator
      .executeIncidentAction({
        incidentId: params.incidentId,
        action: params.action,
        assignee: targetAssignee,
      })
      .subscribe({
        next: (response) => {
          const active = this.inFlightMutations.get(params.incidentId);
          if (!active || active.mutationId !== mutationId) {
            return;
          }
          this.inFlightMutations.delete(params.incidentId);

          const latestMap = new Map(this.incidentMapState());
          const latest = latestMap.get(params.incidentId);
          if (!latest) {
            return;
          }

          const confirmedSequence = latest.lastSequence + 1;
          const confirmedEntry: Incident['timeline'][number] = {
            id: `confirm-${mutationId}`,
            timestamp: response.processedAt,
            sequence: confirmedSequence,
            actor: params.actor,
            summary: `Confirmed ${params.action} in ${response.latencyMs}ms`,
            kind: 'operator-action',
          };
          const confirmedIncident: Incident = {
            ...latest,
            pendingAction: null,
            lastSequence: confirmedSequence,
            updatedAt: response.processedAt,
            timeline: [
              confirmedEntry,
              ...latest.timeline.filter((entry) => !entry.id.startsWith('opt-')),
            ].slice(0, 25),
          };

          latestMap.set(params.incidentId, confirmedIncident);
          this.incidentMapState.set(latestMap);
        },
        error: (err: unknown) => {
          const active = this.inFlightMutations.get(params.incidentId);
          if (!active || active.mutationId !== mutationId) {
            return;
          }
          this.inFlightMutations.delete(params.incidentId);

          // Roll back cleanly to authoritative `serverBaseline` (which includes any concurrent forward telemetry)
          const rollbackMap = new Map(this.incidentMapState());
          const rollbackEntry: Incident['timeline'][number] = {
            id: `rollback-${mutationId}`,
            timestamp: Date.now(),
            sequence: active.serverBaseline.lastSequence,
            actor: 'reconciler',
            summary: `Rolled back optimistic ${params.action}: upstream write rejected`,
            kind: 'rollback',
          };
          const restoredIncident: Incident = {
            ...active.serverBaseline,
            pendingAction: null,
            timeline: [rollbackEntry, ...active.serverBaseline.timeline].slice(0, 25),
          };
          rollbackMap.set(params.incidentId, restoredIncident);
          this.incidentMapState.set(rollbackMap);

          this.throughputState.update((prev) => ({
            ...prev,
            rollbacksTriggered: prev.rollbacksTriggered + 1,
          }));

          const detail =
            err instanceof Error
              ? err.message
              : `Could not ${params.action} ${params.incidentId}; state rolled back.`;

          this.toastService.push({
            variant: 'error',
            title: `Action Rolled Back (${params.incidentId})`,
            detail,
          });
        },
      });
  }

  private startPerformanceSampler(): void {
    if (!isPlatformBrowser(this.platformId) || this.metricsSamplerTimer !== null) {
      return;
    }

    const tickFrame = (): void => {
      this.framesRenderedInWindow++;
      this.rafHandle = requestAnimationFrame(tickFrame);
    };
    this.rafHandle = requestAnimationFrame(tickFrame);

    this.metricsSamplerTimer = setInterval(() => {
      const rawCount = this.streamSimulator.consumeRawEventCount();
      const batches = this.batchesInWindow;
      const batchedEvents = this.batchEventsInWindow;
      const fps = Math.min(60, Math.max(1, this.framesRenderedInWindow));

      this.batchesInWindow = 0;
      this.batchEventsInWindow = 0;
      this.framesRenderedInWindow = 0;

      this.throughputState.update((prev) => ({
        ...prev,
        rawEventsPerSec: rawCount,
        renderBatchesPerSec: batches,
        avgBatchSize: batches > 0 ? Math.round(batchedEvents / batches) : 0,
        uiFps: fps,
      }));
    }, 1000);
  }

  private teardown(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
    this.searchSubscription?.unsubscribe();
    this.searchSubscription = null;
    this.streamSimulator.stopEngine();

    if (this.metricsSamplerTimer !== null) {
      clearInterval(this.metricsSamplerTimer);
      this.metricsSamplerTimer = null;
    }
    if (this.rafHandle !== null && isPlatformBrowser(this.platformId)) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }
}
