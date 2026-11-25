import { Incident, OptimisticMutation, TelemetryEvent } from '../models/incident.model';
import {
  BoundedEventIdSet,
  buildOptimisticIncident,
  filterAndSortIncidents,
  reconcileTelemetryBatch,
} from './incident-reconciler';

function makeSeedIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-00100',
    title: 'Elevated HTTP 502 gateway timeouts (payments-gateway)',
    service: 'payments-gateway',
    region: 'us-east-1',
    severity: 'High',
    status: 'Investigating',
    assignee: 'sara.khalil',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
    acknowledgedAt: 1_700_000_030_000,
    resolvedAt: null,
    lastSequence: 5,
    pendingAction: null,
    metrics: {
      errorRatePct: 4.5,
      p99LatencyMs: 620,
      affectedRps: 480,
    },
    tags: ['slo-breach', 'tier-0'],
    timeline: [
      {
        id: 'evt-seq-5',
        timestamp: 1_700_000_060_000,
        sequence: 5,
        actor: 'sara.khalil',
        summary: 'Investigating upstream saturation',
        kind: 'operator-action',
      },
    ],
    ...overrides,
  };
}

describe('incident-reconciler (pure deduplication & causal reconciliation)', () => {
  describe('BoundedEventIdSet', () => {
    it('evicts oldest eventIds FIFO when capacity is exceeded to prevent memory leaks', () => {
      const ring = new BoundedEventIdSet(3);
      ring.add('evt-1');
      ring.add('evt-2');
      ring.add('evt-3');
      expect(ring.size).toBe(3);
      expect(ring.has('evt-1')).toBe(true);

      ring.add('evt-4');
      expect(ring.size).toBe(3);
      expect(ring.has('evt-1')).toBe(false);
      expect(ring.has('evt-2')).toBe(true);
      expect(ring.has('evt-4')).toBe(true);
    });
  });

  describe('reconcileTelemetryBatch — deduplication & out-of-order handling', () => {
    it('drops duplicate eventIds within the same batch and across subsequent batches', () => {
      const seen = new BoundedEventIdSet(100);
      const createEvt: TelemetryEvent = {
        eventId: 'evt-dup-1',
        incidentId: 'INC-20001',
        sequence: 1,
        timestamp: 1_700_000_100_000,
        type: 'INCIDENT_CREATED',
        payload: {
          title: 'Kafka consumer lag spike',
          service: 'kafka-ingest-eu',
          region: 'eu-central-1',
          severity: 'Critical',
          status: 'Open',
          summary: 'Opened incident',
        },
      };

      const firstPass = reconcileTelemetryBatch(new Map(), new Map(), seen, [
        createEvt,
        { ...createEvt, isSimulatedDuplicate: true },
      ]);

      expect(firstPass.acceptedCount).toBe(1);
      expect(firstPass.duplicatesDropped).toBe(1);
      expect(firstPass.incidentsById.size).toBe(1);

      const secondPass = reconcileTelemetryBatch(
        firstPass.incidentsById,
        firstPass.inFlightMutations,
        seen,
        [createEvt],
      );

      expect(secondPass.mutated).toBe(false);
      expect(secondPass.acceptedCount).toBe(0);
      expect(secondPass.duplicatesDropped).toBe(1);
    });

    it('reconciles out-of-order stale sequence events without regressing newer incident state', () => {
      const seen = new BoundedEventIdSet(100);
      const current = makeSeedIncident({
        id: 'INC-00100',
        severity: 'Critical',
        status: 'Investigating',
        assignee: 'sara.khalil',
        lastSequence: 5,
        metrics: { errorRatePct: 9.2, p99LatencyMs: 1120, affectedRps: 900 },
      });

      const initialMap = new Map<string, Incident>([[current.id, current]]);

      // Delayed packet from sequence #3 claiming incident is still Low / Open
      const delayedStaleEvent: TelemetryEvent = {
        eventId: 'evt-late-seq-3',
        incidentId: 'INC-00100',
        sequence: 3,
        timestamp: 1_700_000_020_000,
        type: 'INCIDENT_UPDATED',
        isSimulatedOutOfOrder: true,
        payload: {
          severity: 'Low',
          status: 'Open',
          assignee: null,
          metrics: { errorRatePct: 0.5, p99LatencyMs: 180, affectedRps: 50 },
          summary: 'Delayed edge collector packet',
        },
      };

      const result = reconcileTelemetryBatch(initialMap, new Map(), seen, [delayedStaleEvent]);
      const reconciled = result.incidentsById.get('INC-00100')!;

      expect(result.outOfOrderReconciled).toBe(1);
      expect(reconciled.status).toBe('Investigating');
      expect(reconciled.severity).toBe('Critical');
      expect(reconciled.assignee).toBe('sara.khalil');
      expect(reconciled.lastSequence).toBe(5);
      expect(reconciled.metrics.p99LatencyMs).toBe(1120);

      // Timeline preserves causal ordering: seq #5 remains ahead of out-of-order seq #3
      expect(reconciled.timeline.length).toBe(2);
      expect(reconciled.timeline[0].sequence).toBe(5);
      expect(reconciled.timeline[1].sequence).toBe(3);
      expect(reconciled.timeline[1].kind).toBe('reconciled-out-of-order');
    });

    it('advances serverBaseline when forward telemetry arrives during an in-flight optimistic mutation', () => {
      const seen = new BoundedEventIdSet(100);
      const baseline = makeSeedIncident({
        id: 'INC-00900',
        status: 'Open',
        assignee: null,
        lastSequence: 2,
        metrics: { errorRatePct: 2.0, p99LatencyMs: 400, affectedRps: 200 },
      });

      const optimistic = buildOptimisticIncident(
        baseline,
        'resolve',
        'alex.chen',
        'alex.chen',
        1_700_000_070_000,
      );

      const map = new Map<string, Incident>([['INC-00900', optimistic]]);
      const inFlight = new Map<string, OptimisticMutation>([
        [
          'INC-00900',
          {
            mutationId: 'mut-1',
            incidentId: 'INC-00900',
            kind: 'resolve',
            serverBaseline: baseline,
            startedAt: 1_700_000_070_000,
          },
        ],
      ]);

      const concurrentTelemetry: TelemetryEvent = {
        eventId: 'evt-seq-3',
        incidentId: 'INC-00900',
        sequence: 3,
        timestamp: 1_700_000_075_000,
        type: 'INCIDENT_ESCALATED',
        payload: {
          severity: 'Critical',
          metrics: { p99LatencyMs: 1450, errorRatePct: 11.4 },
          summary: 'Spike detected while resolve request in flight',
        },
      };

      const result = reconcileTelemetryBatch(map, inFlight, seen, [concurrentTelemetry]);
      const displayed = result.incidentsById.get('INC-00900')!;
      const updatedMutation = result.inFlightMutations.get('INC-00900')!;

      // Operator's optimistic Resolved status & pendingAction stay intact on screen
      expect(displayed.status).toBe('Resolved');
      expect(displayed.pendingAction).toBe('resolve');
      expect(displayed.metrics.p99LatencyMs).toBe(1450);

      // Underlying serverBaseline absorbed seq #3 so rollback won't lose live metrics
      expect(updatedMutation.serverBaseline.status).toBe('Open');
      expect(updatedMutation.serverBaseline.lastSequence).toBe(3);
      expect(updatedMutation.serverBaseline.metrics.p99LatencyMs).toBe(1450);
    });
  });

  describe('filterAndSortIncidents', () => {
    it('filters by multi-facet severities, statuses, and keyword query and sorts deterministically', () => {
      const dataset: Incident[] = [
        makeSeedIncident({
          id: 'INC-00001',
          severity: 'Critical',
          status: 'Open',
          service: 'auth-edge-proxy',
          metrics: { errorRatePct: 12, p99LatencyMs: 1300, affectedRps: 800 },
        }),
        makeSeedIncident({
          id: 'INC-00002',
          severity: 'High',
          status: 'Open',
          service: 'payments-gateway',
          metrics: { errorRatePct: 5, p99LatencyMs: 750, affectedRps: 410 },
        }),
        makeSeedIncident({
          id: 'INC-00003',
          severity: 'Critical',
          status: 'Resolved',
          service: 'auth-edge-proxy',
          metrics: { errorRatePct: 0.2, p99LatencyMs: 190, affectedRps: 90 },
        }),
      ];

      const filtered = filterAndSortIncidents(dataset, {
        severities: ['Critical', 'High'],
        statuses: ['Open'],
        searchQuery: 'auth',
        sortBy: 'severity',
        sortDirection: 'desc',
      });

      expect(filtered.map((i) => i.id)).toEqual(['INC-00001']);
    });
  });
});
