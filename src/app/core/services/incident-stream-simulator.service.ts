import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { bufferTime, filter, share } from 'rxjs/operators';
import {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  STREAM_RATE_EVENTS_PER_SEC,
  StreamRatePreset,
  TelemetryEvent,
} from '../models/incident.model';
import { ConnectionResilienceService } from './connection-resilience.service';

const SERVICES: readonly string[] = [
  'payments-gateway',
  'auth-edge-proxy',
  'checkout-orchestrator',
  'kafka-ingest-eu',
  'search-shard-router',
  'ledger-settlement',
  'fraud-scorer-ml',
  'cdn-shield-me',
  'inventory-sync',
  'notification-dispatcher',
];

const REGIONS: readonly string[] = [
  'us-east-1',
  'us-west-2',
  'eu-central-1',
  'me-central-1',
  'ap-northeast-1',
  'ap-southeast-1',
];

const OPERATORS: readonly string[] = [
  'sara.khalil',
  'alex.chen',
  'omar.mansour',
  'elena.rostova',
  'devon.park',
];

const SYMPTOMS: readonly string[] = [
  'Elevated HTTP 502 gateway timeouts at ingress',
  'Connection pool exhaustion on primary read replica',
  'Consumer group lag exceeding SLO threshold',
  'TLS handshake latency spike across edge POPs',
  'gRPC deadline exceeded on downstream dependency',
  'Out-of-memory pod restarts in canary deployment',
  'Redis cluster slot migration stall detected',
  'Circuit breaker tripped due to upstream saturation',
];

const TAG_POOL: readonly string[][] = [
  ['slo-breach', 'tier-0', 'pager'],
  ['database', 'latency', 'replica'],
  ['kafka', 'backpressure', 'streaming'],
  ['edge', 'tls', 'network'],
  ['canary', 'k8s', 'oom'],
];

@Injectable({ providedIn: 'root' })
export class IncidentStreamSimulatorService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly resilience = inject(ConnectionResilienceService);

  private readonly rawEventSubject = new Subject<TelemetryEvent>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private eventCounter = 1;
  private nextIncidentNumber = 10_001;
  private fractionalCarry = 0;

  /** Tracks authoritative per-incident sequence numbers inside the simulator to craft realistic chaos anomalies. */
  private readonly sequenceLedger = new Map<string, number>();
  private readonly activeIncidentRing: string[] = [];
  private recentEmittedEvents: TelemetryEvent[] = [];

  readonly ratePreset = signal<StreamRatePreset>('Normal');
  readonly chaosAnomaliesEnabled = signal<boolean>(false);

  /** Raw unbuffered counter incremented per emitted wire event for live ingestion telemetry. */
  private rawIngestedSinceLastSample = 0;

  /**
   * Unbuffered stream of raw telemetry events (up to 1,000+ events/sec in Burst mode).
   */
  readonly rawEvents$: Observable<TelemetryEvent> = this.rawEventSubject.asObservable();

  /**
   * Backpressure-controlled stream:
   * Drops transport frames while simulated connection is down, then coalesces bursts into
   * 100ms micro-batches (max 10 Signal store commits/sec) to preserve 60fps UI responsiveness.
   */
  readonly bufferedEvents$: Observable<readonly TelemetryEvent[]> = this.rawEventSubject.pipe(
    filter(() => this.resilience.isConnected()),
    bufferTime(100),
    filter((batch): batch is TelemetryEvent[] => batch.length > 0),
    share(),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.stopEngine());
  }

  /**
   * Generates a deterministic-feeling high-density seed corpus (default: 10,000 incidents)
   * so `@angular/cdk/scrolling` virtual scroll can be benchmarked immediately at scale.
   */
  generateSeedIncidents(count = 10_000): Incident[] {
    const now = Date.now();
    const seeded: Incident[] = new Array<Incident>(count);

    this.sequenceLedger.clear();
    this.activeIncidentRing.length = 0;

    for (let i = 0; i < count; i++) {
      const numericId = 10_000 - i;
      const id = `INC-${String(numericId).padStart(5, '0')}`;
      const service = SERVICES[i % SERVICES.length];
      const region = REGIONS[(i * 3) % REGIONS.length];
      const symptom = SYMPTOMS[(i * 7) % SYMPTOMS.length];
      const tags = TAG_POOL[i % TAG_POOL.length];

      const severity = this.pickSeedSeverity(i);
      const status = this.pickSeedStatus(i);
      const createdAt = now - i * 42_000 - ((i * 997) % 15_000);
      const ackDelayMs = 28_000 + ((i * 4_391) % 190_000);

      const acknowledgedAt =
        status === 'Investigating' || status === 'Resolved' ? createdAt + ackDelayMs : null;
      const resolvedAt = status === 'Resolved' ? createdAt + ackDelayMs + 180_000 : null;
      const updatedAt = resolvedAt ?? acknowledgedAt ?? createdAt + 5_000;
      const assignee = status === 'Open' ? null : OPERATORS[i % OPERATORS.length];
      const initialSequence = status === 'Resolved' ? 3 : status === 'Investigating' ? 2 : 1;

      const severityFactor =
        severity === 'Critical' ? 4 : severity === 'High' ? 2.4 : severity === 'Medium' ? 1.4 : 0.6;

      this.sequenceLedger.set(id, initialSequence);
      if (i < 400 && status !== 'Resolved') {
        this.activeIncidentRing.push(id);
      }

      seeded[i] = {
        id,
        title: `${symptom} (${service})`,
        service,
        region,
        severity,
        status,
        assignee,
        createdAt,
        updatedAt,
        acknowledgedAt,
        resolvedAt,
        lastSequence: initialSequence,
        pendingAction: null,
        metrics: {
          errorRatePct: Number((severityFactor * (1.2 + (i % 7) * 0.45)).toFixed(2)),
          p99LatencyMs: Math.round(180 * severityFactor + (i % 19) * 35),
          affectedRps: Math.round(120 * severityFactor + (i % 23) * 40),
        },
        tags,
        timeline: [
          {
            id: `seed-evt-${id}`,
            timestamp: updatedAt,
            sequence: initialSequence,
            actor: assignee ?? 'prometheus-alertmanager',
            summary:
              status === 'Open'
                ? `Alert triggered: ${symptom}`
                : `Status transitioned to ${status}`,
            kind: 'ingested',
          },
        ],
      };
    }

    this.nextIncidentNumber = 10_001;
    return seeded;
  }

  startEngine(): void {
    if (this.tickTimer !== null) {
      return;
    }

    // 20ms scheduler tick (50 ticks/sec) smoothly drives 5/sec, 250/sec (5/tick), and 1,000/sec (20/tick)
    const tickIntervalMs = 20;
    this.tickTimer = setInterval(() => {
      const targetPerSec = STREAM_RATE_EVENTS_PER_SEC[this.ratePreset()];
      if (targetPerSec <= 0 || !this.resilience.isConnected()) {
        return;
      }

      const exactEventsThisTick = (targetPerSec * tickIntervalMs) / 1000 + this.fractionalCarry;
      const wholeEvents = Math.floor(exactEventsThisTick);
      this.fractionalCarry = exactEventsThisTick - wholeEvents;

      for (let i = 0; i < wholeEvents; i++) {
        this.emitGeneratedEvent();
      }
    }, tickIntervalMs);
  }

  stopEngine(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  setRatePreset(preset: StreamRatePreset): void {
    this.ratePreset.set(preset);
    this.fractionalCarry = 0;
  }

  toggleContinuousChaos(): void {
    this.chaosAnomaliesEnabled.update((enabled) => !enabled);
  }

  /**
   * Injects an immediate burst of duplicate `eventId` frames and stale out-of-order `sequence`
   * events so operators can verify deduplication and causal reconciliation on demand.
   */
  injectChaosAnomalyBurst(pairCount = 5): void {
    for (let i = 0; i < pairCount; i++) {
      // Ensure we have a fresh canonical event first, then immediately replay its eventId (duplicate)
      const canonical = this.buildCanonicalEvent();
      this.dispatchRaw(canonical);

      const duplicateFrame: TelemetryEvent = {
        ...canonical,
        isSimulatedDuplicate: true,
      };
      this.dispatchRaw(duplicateFrame);

      // Emit an out-of-order stale frame with sequence <= current sequence for the same incident
      const currentSeq = this.sequenceLedger.get(canonical.incidentId) ?? 2;
      const staleSeq = Math.max(1, currentSeq - 1);
      const outOfOrderFrame: TelemetryEvent = {
        eventId: `evt-ooo-${this.eventCounter++}`,
        incidentId: canonical.incidentId,
        sequence: staleSeq,
        timestamp: canonical.timestamp - 4_500,
        type: 'INCIDENT_UPDATED',
        isSimulatedOutOfOrder: true,
        payload: {
          status: 'Open',
          severity: 'Low',
          summary: `Delayed partition telemetry frame (seq #${staleSeq})`,
          actor: 'partitioned-broker-eu',
        },
      };
      this.dispatchRaw(outOfOrderFrame);
    }
  }

  /**
   * Allows tests or manual triggers to push arbitrary TelemetryEvents through the backpressure pipeline.
   */
  pushCustomEvent(event: TelemetryEvent): void {
    this.dispatchRaw(event);
  }

  consumeRawEventCount(): number {
    const count = this.rawIngestedSinceLastSample;
    this.rawIngestedSinceLastSample = 0;
    return count;
  }

  private emitGeneratedEvent(): void {
    const injectChaos = this.chaosAnomaliesEnabled();

    if (injectChaos && this.recentEmittedEvents.length > 0) {
      const roll = Math.random();
      if (roll < 0.08) {
        // 8% duplicate packet replay
        const replay =
          this.recentEmittedEvents[Math.floor(Math.random() * this.recentEmittedEvents.length)];
        this.dispatchRaw({ ...replay, isSimulatedDuplicate: true });
        return;
      }
      if (roll < 0.16 && this.activeIncidentRing.length > 0) {
        // 8% out-of-order delayed packet
        const targetId =
          this.activeIncidentRing[Math.floor(Math.random() * this.activeIncidentRing.length)];
        const knownSeq = this.sequenceLedger.get(targetId) ?? 2;
        const staleSequence = Math.max(1, knownSeq - 1);
        this.dispatchRaw({
          eventId: `evt-${this.eventCounter++}`,
          incidentId: targetId,
          sequence: staleSequence,
          timestamp: Date.now() - 6_000,
          type: 'HEARTBEAT_METRIC',
          isSimulatedOutOfOrder: true,
          payload: {
            status: 'Open',
            summary: `Late-arriving metric sample from lagging edge collector`,
            actor: 'otel-collector-lag',
          },
        });
        return;
      }
    }

    const canonical = this.buildCanonicalEvent();
    this.dispatchRaw(canonical);
  }

  private buildCanonicalEvent(): TelemetryEvent {
    const now = Date.now();
    const shouldCreateNew = this.activeIncidentRing.length === 0 || Math.random() < 0.18;

    if (shouldCreateNew) {
      const id = `INC-${String(this.nextIncidentNumber++).padStart(5, '0')}`;
      const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
      const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
      const symptom = SYMPTOMS[Math.floor(Math.random() * SYMPTOMS.length)];
      const severity = this.pickLiveSeverity();
      const tags = TAG_POOL[Math.floor(Math.random() * TAG_POOL.length)];
      const factor = severity === 'Critical' ? 4.2 : severity === 'High' ? 2.5 : 1.3;

      this.sequenceLedger.set(id, 1);
      this.activeIncidentRing.unshift(id);
      if (this.activeIncidentRing.length > 500) {
        this.activeIncidentRing.pop();
      }

      return {
        eventId: `evt-${this.eventCounter++}`,
        incidentId: id,
        sequence: 1,
        timestamp: now,
        type: 'INCIDENT_CREATED',
        payload: {
          title: `${symptom} (${service})`,
          service,
          region,
          severity,
          status: 'Open',
          tags,
          metrics: {
            errorRatePct: Number((factor * (1.1 + Math.random() * 2.8)).toFixed(2)),
            p99LatencyMs: Math.round(210 * factor + Math.random() * 480),
            affectedRps: Math.round(150 * factor + Math.random() * 900),
          },
          summary: `New ${severity.toLowerCase()} incident opened on ${service} [${region}]`,
          actor: 'alertmanager-webhook',
        },
      };
    }

    const targetIndex = Math.floor(Math.random() * this.activeIncidentRing.length);
    const incidentId = this.activeIncidentRing[targetIndex];
    const nextSeq = (this.sequenceLedger.get(incidentId) ?? 1) + 1;
    this.sequenceLedger.set(incidentId, nextSeq);

    const escalateRoll = Math.random();
    if (escalateRoll < 0.12) {
      return {
        eventId: `evt-${this.eventCounter++}`,
        incidentId,
        sequence: nextSeq,
        timestamp: now,
        type: 'INCIDENT_ESCALATED',
        payload: {
          severity: Math.random() < 0.45 ? 'Critical' : 'High',
          metrics: {
            errorRatePct: Number((6 + Math.random() * 12).toFixed(2)),
            p99LatencyMs: Math.round(850 + Math.random() * 1400),
          },
          summary: `Anomaly burn-rate escalated; error budget consumption > 14.4x`,
          actor: 'slo-burn-watcher',
        },
      };
    }

    return {
      eventId: `evt-${this.eventCounter++}`,
      incidentId,
      sequence: nextSeq,
      timestamp: now,
      type: 'HEARTBEAT_METRIC',
      payload: {
        metrics: {
          errorRatePct: Number((0.8 + Math.random() * 7.5).toFixed(2)),
          p99LatencyMs: Math.round(190 + Math.random() * 920),
          affectedRps: Math.round(140 + Math.random() * 1100),
        },
        summary: `Streaming telemetry window updated (seq #${nextSeq})`,
        actor: 'otel-stream',
      },
    };
  }

  private dispatchRaw(event: TelemetryEvent): void {
    this.rawIngestedSinceLastSample++;
    if (!event.isSimulatedDuplicate) {
      this.recentEmittedEvents.push(event);
      if (this.recentEmittedEvents.length > 64) {
        this.recentEmittedEvents.shift();
      }
    }
    this.rawEventSubject.next(event);
  }

  private pickSeedSeverity(index: number): IncidentSeverity {
    const mod = index % 20;
    if (mod === 0) return 'Critical';
    if (mod <= 4) return 'High';
    if (mod <= 12) return 'Medium';
    return 'Low';
  }

  private pickSeedStatus(index: number): IncidentStatus {
    const mod = index % 10;
    if (mod <= 2) return 'Open';
    if (mod <= 5) return 'Investigating';
    return 'Resolved';
  }

  private pickLiveSeverity(): IncidentSeverity {
    const r = Math.random();
    if (r < 0.14) return 'Critical';
    if (r < 0.38) return 'High';
    if (r < 0.75) return 'Medium';
    return 'Low';
  }
}
