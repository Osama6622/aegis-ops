import { TestBed } from '@angular/core/testing';
import { Incident, TelemetryEvent } from '../models/incident.model';
import { ConnectionResilienceService } from '../services/connection-resilience.service';
import { IncidentApiSimulatorService } from '../services/incident-api-simulator.service';
import { IncidentStreamSimulatorService } from '../services/incident-stream-simulator.service';
import { ToastService } from '../services/toast.service';
import { TelemetryStoreService } from './telemetry-store.service';

function createFixtureIncidents(): Incident[] {
  return [
    {
      id: 'INC-01001',
      title: 'Ingress 502 spike (payments-gateway)',
      service: 'payments-gateway',
      region: 'us-east-1',
      severity: 'Critical',
      status: 'Open',
      assignee: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_010_000,
      acknowledgedAt: null,
      resolvedAt: null,
      lastSequence: 1,
      pendingAction: null,
      metrics: { errorRatePct: 14.2, p99LatencyMs: 1420, affectedRps: 1200 },
      tags: ['tier-0', 'payments'],
      timeline: [
        {
          id: 'seed-1',
          timestamp: 1_700_000_010_000,
          sequence: 1,
          actor: 'alertmanager',
          summary: 'Incident opened',
          kind: 'ingested',
        },
      ],
    },
    {
      id: 'INC-01002',
      title: 'Replica lag warning (ledger-settlement)',
      service: 'ledger-settlement',
      region: 'eu-central-1',
      severity: 'High',
      status: 'Investigating',
      assignee: 'omar.mansour',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_060_000,
      acknowledgedAt: 1_700_000_060_000,
      resolvedAt: null,
      lastSequence: 2,
      pendingAction: null,
      metrics: { errorRatePct: 3.1, p99LatencyMs: 540, affectedRps: 310 },
      tags: ['database', 'replica'],
      timeline: [
        {
          id: 'seed-2',
          timestamp: 1_700_000_060_000,
          sequence: 2,
          actor: 'omar.mansour',
          summary: 'Acknowledged',
          kind: 'operator-action',
        },
      ],
    },
    {
      id: 'INC-01003',
      title: 'Edge cache miss elevation (cdn-shield-me)',
      service: 'cdn-shield-me',
      region: 'me-central-1',
      severity: 'Low',
      status: 'Resolved',
      assignee: 'sara.khalil',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_180_000,
      acknowledgedAt: 1_700_000_030_000,
      resolvedAt: 1_700_000_180_000,
      lastSequence: 3,
      pendingAction: null,
      metrics: { errorRatePct: 0.4, p99LatencyMs: 140, affectedRps: 85 },
      tags: ['edge', 'cdn'],
      timeline: [
        {
          id: 'seed-3',
          timestamp: 1_700_000_180_000,
          sequence: 3,
          actor: 'sara.khalil',
          summary: 'Resolved',
          kind: 'operator-action',
        },
      ],
    },
  ];
}

describe('TelemetryStoreService', () => {
  let store: TelemetryStoreService;
  let apiSimulator: IncidentApiSimulatorService;
  let toastService: ToastService;
  let streamSimulator: IncidentStreamSimulatorService;
  let resilience: ConnectionResilienceService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});

    store = TestBed.inject(TelemetryStoreService);
    apiSimulator = TestBed.inject(IncidentApiSimulatorService);
    toastService = TestBed.inject(ToastService);
    streamSimulator = TestBed.inject(IncidentStreamSimulatorService);
    resilience = TestBed.inject(ConnectionResilienceService);

    store.seedIncidents(createFixtureIncidents());
  });

  afterEach(() => {
    toastService.clearAll();
    vi.useRealTimers();
  });

  describe('1. Deduplication & Out-of-Order Reconciliation in Store', () => {
    it('tracks duplicatesDropped and outOfOrderReconciled accurately across ingested batches', () => {
      const forwardEvent: TelemetryEvent = {
        eventId: 'evt-100',
        incidentId: 'INC-01001',
        sequence: 4,
        timestamp: 1_700_000_050_000,
        type: 'INCIDENT_UPDATED',
        payload: {
          status: 'Investigating',
          assignee: 'elena.rostova',
          summary: 'Escalated to investigating on seq #4',
        },
      };

      const duplicateOfForward: TelemetryEvent = {
        ...forwardEvent,
        isSimulatedDuplicate: true,
      };

      const staleOutOfOrder: TelemetryEvent = {
        eventId: 'evt-101-stale',
        incidentId: 'INC-01001',
        sequence: 2,
        timestamp: 1_700_000_020_000,
        type: 'INCIDENT_UPDATED',
        isSimulatedOutOfOrder: true,
        payload: {
          status: 'Open',
          assignee: null,
          summary: 'Delayed seq #2 packet',
        },
      };

      store.ingestBatch([forwardEvent, duplicateOfForward, staleOutOfOrder]);

      const updated = store.allIncidents().find((i) => i.id === 'INC-01001')!;
      expect(updated.status).toBe('Investigating');
      expect(updated.assignee).toBe('elena.rostova');
      expect(updated.lastSequence).toBe(4);

      expect(store.throughput().duplicatesDropped).toBe(1);
      expect(store.throughput().outOfOrderReconciled).toBe(1);
      expect(store.throughput().totalEventsProcessed).toBe(2);
    });
  });

  describe('2. Optimistic Updates & Simulated API Failure Rollback', () => {
    it('applies optimistic acknowledge immediately (<1ms) and confirms state on API success', () => {
      apiSimulator.configure({ minLatencyMs: 400, maxLatencyMs: 400, failureRate: 0 });

      store.acknowledgeIncident('INC-01001', 'alex.chen');

      // Immediate optimistic projection before network timer resolves
      const optimistic = store.allIncidents().find((i) => i.id === 'INC-01001')!;
      expect(optimistic.status).toBe('Investigating');
      expect(optimistic.assignee).toBe('alex.chen');
      expect(optimistic.pendingAction).toBe('acknowledge');
      expect(optimistic.acknowledgedAt).not.toBeNull();

      // Advance simulated 400ms network latency
      vi.advanceTimersByTime(450);

      const confirmed = store.allIncidents().find((i) => i.id === 'INC-01001')!;
      expect(confirmed.status).toBe('Investigating');
      expect(confirmed.pendingAction).toBeNull();
      expect(confirmed.lastSequence).toBe(2);
      expect(toastService.toasts().length).toBe(0);
    });

    it('rolls back optimistic state cleanly on simulated API failure while preserving concurrent forward telemetry and showing an error toast', () => {
      apiSimulator.configure({ minLatencyMs: 500, maxLatencyMs: 500, failureRate: 1 });

      store.resolveIncident('INC-01001', 'alex.chen');

      // Verify immediate optimistic transition to Resolved
      const optimistic = store.allIncidents().find((i) => i.id === 'INC-01001')!;
      expect(optimistic.status).toBe('Resolved');
      expect(optimistic.pendingAction).toBe('resolve');

      // While HTTP write is in flight (at t = 200ms), live stream telemetry updates metrics on seq #2
      vi.advanceTimersByTime(200);
      store.ingestBatch([
        {
          eventId: 'evt-concurrent-seq-2',
          incidentId: 'INC-01001',
          sequence: 2,
          timestamp: 1_700_000_025_000,
          type: 'HEARTBEAT_METRIC',
          payload: {
            metrics: { p99LatencyMs: 1890, errorRatePct: 19.5 },
            summary: 'Live metric surge while resolve mutation in flight',
          },
        },
      ]);

      // Complete remaining latency so simulated 503 failure fires
      vi.advanceTimersByTime(350);

      const rolledBack = store.allIncidents().find((i) => i.id === 'INC-01001')!;
      expect(rolledBack.status).toBe('Open');
      expect(rolledBack.resolvedAt).toBeNull();
      expect(rolledBack.pendingAction).toBeNull();
      // Concurrent forward telemetry was preserved rather than clobbered!
      expect(rolledBack.metrics.p99LatencyMs).toBe(1890);
      expect(rolledBack.lastSequence).toBe(2);
      expect(rolledBack.timeline[0].kind).toBe('rollback');

      expect(store.throughput().rollbacksTriggered).toBe(1);
      expect(toastService.toasts().length).toBe(1);
      expect(toastService.toasts()[0].variant).toBe('error');
      expect(toastService.toasts()[0].title).toContain('INC-01001');
    });
  });

  describe('3. Multi-Facet Filtering, Debounced Search, Sorting & KPI Computed Signals', () => {
    it('computes activeCriticalCount and meanTimeToAckMs KPIs accurately from reactive state', () => {
      // INC-01001 is Critical + Open (active); INC-01002 acked in 60s; INC-01003 acked in 30s -> mean = 45,000ms
      expect(store.activeCriticalCount()).toBe(1);
      expect(store.meanTimeToAckMs()).toBe(45_000);
    });

    it('filters incidents reactively across severity, status, and debounced keyword search Signals', () => {
      expect(store.filteredIncidents().length).toBe(3);

      // Filter to Open + Investigating only
      store.setStatuses(['Open', 'Investigating']);
      expect(store.filteredIncidents().map((i) => i.id)).toEqual(['INC-01002', 'INC-01001']);

      // Type debounced keyword query ('payments') — should wait 180ms before recomputing filteredIncidents
      store.setSearchQuery('payments');
      expect(store.filteredIncidents().length).toBe(2);

      vi.advanceTimersByTime(179);
      expect(store.filteredIncidents().length).toBe(2);

      vi.advanceTimersByTime(2);
      expect(store.filteredIncidents().map((i) => i.id)).toEqual(['INC-01001']);
    });

    it('re-sorts filteredIncidents deterministically when sortBy and sortDirection change', () => {
      store.setSorting('p99LatencyMs', 'desc');
      expect(store.filteredIncidents().map((i) => i.id)).toEqual([
        'INC-01001',
        'INC-01002',
        'INC-01003',
      ]);

      store.setSorting('p99LatencyMs', 'asc');
      expect(store.filteredIncidents().map((i) => i.id)).toEqual([
        'INC-01003',
        'INC-01002',
        'INC-01001',
      ]);
    });
  });

  describe('4. Backpressure Stream Buffering & Exponential Backoff Gating', () => {
    it('coalesces high-frequency raw events into a single 100ms batch and gates frames when disconnected', () => {
      const receivedBatches: Array<readonly TelemetryEvent[]> = [];
      const sub = streamSimulator.bufferedEvents$.subscribe((batch) => receivedBatches.push(batch));

      // Emit 25 events within 10ms -> should coalesce into 1 batch at 100ms
      for (let i = 0; i < 25; i++) {
        streamSimulator.pushCustomEvent({
          eventId: `burst-${i}`,
          incidentId: 'INC-01001',
          sequence: i + 10,
          timestamp: Date.now(),
          type: 'HEARTBEAT_METRIC',
          payload: { summary: `Burst ${i}` },
        });
      }

      expect(receivedBatches.length).toBe(0);
      vi.advanceTimersByTime(105);
      expect(receivedBatches.length).toBe(1);
      expect(receivedBatches[0].length).toBe(25);

      // Simulate disconnect -> transport drops incoming wire frames while offline
      resilience.configure({ baseDelayMs: 1000, jitterRatio: 0, simulatedFailuresBeforeRecovery: 1 });
      resilience.simulateDisconnect('Chaos test disconnect');
      expect(resilience.isConnected()).toBe(false);
      expect(resilience.state().attempt).toBe(1);
      expect(resilience.state().currentBackoffDelayMs).toBe(1000);

      streamSimulator.pushCustomEvent({
        eventId: 'dropped-while-offline',
        incidentId: 'INC-01001',
        sequence: 99,
        timestamp: Date.now(),
        type: 'HEARTBEAT_METRIC',
        payload: { summary: 'Should be gated' },
      });

      vi.advanceTimersByTime(200);
      expect(receivedBatches.length).toBe(1);

      // Attempt #1 fails at 1000ms -> escalates to Attempt #2 with 2000ms exponential backoff
      vi.advanceTimersByTime(850);
      expect(resilience.state().attempt).toBe(2);
      expect(resilience.state().currentBackoffDelayMs).toBe(2000);

      // Attempt #2 succeeds after 2000ms -> Connected!
      vi.advanceTimersByTime(2050);
      expect(resilience.isConnected()).toBe(true);

      sub.unsubscribe();
    });
  });
});
