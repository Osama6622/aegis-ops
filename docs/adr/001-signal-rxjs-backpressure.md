# ADR 001: Coalescing High-Frequency RxJS Telemetry into Angular Signals via `bufferTime(100)`

- **Status:** Accepted
- **Date:** 2026-11-25
- **Context:** Real-Time Operational & Incident Management Console (`Aegis Ops`)

## Context & Problem Statement

During operational incident storms (`Spike: 250 events/sec` and `Burst: 1,000 events/sec`), raw WebSocket/SSE telemetry frames arrive sub-millisecond apart. Pushing each individual `TelemetryEvent` directly into an Angular `signal<ReadonlyMap<string, Incident>>` triggers:

1. Up to **1,000 Map clones + computed Signal invalidations per second** (`filteredIncidents` sorting/filtering 10,000+ entities on every frame).
2. Main-thread layout thrashing that starves browser input responsiveness and drops frame rates well below 60fps.
3. Unbounded memory growth if deduplication sets store every historical `eventId` indefinitely.

## Decision

We adopt a **hybrid RxJS-to-Signal boundary** with explicit time-window backpressure:

1. **Asynchronous Transport & Backpressure Layer (RxJS):**
   - `IncidentStreamSimulatorService` emits unbuffered wire frames on `rawEvents$`, filters frames while `ConnectionResilienceService` is disconnected, and coalesces bursts with `bufferTime(100)` + `filter(batch => batch.length > 0)`.
   - Regardless of whether ingestion runs at `5/sec` or `1,000/sec`, `TelemetryStoreService` executes **at most 10 atomic Signal commits per second** (one every 100ms, well within human perceptual latency thresholds of ~100ms).
2. **Synchronous Reactive Projection Layer (Angular Signals):**
   - Inside `ingestBatch(batch)`, all events in the 100ms window are reconciled in memory against a single `Map<string, Incident>` clone before calling `incidentMapState.set(nextMap)` **once**.
   - Downstream `computed()` Signals (`filteredIncidents`, `activeCriticalCount`, `meanTimeToAckMs`, `selectedIncident`) recalculate at most 10 times/sec and drive `ChangeDetectionStrategy.OnPush` + `@angular/cdk/scrolling` virtualized rows cleanly at 60fps.
3. **Bounded `O(1)` Deduplication (`BoundedEventIdSet`):**
   - `seenEventIds` uses JavaScript `Set` insertion-order guarantees to cap retention at `50,000` recent IDs, evicting the oldest entry in `O(1)` when full.

## Consequences

- **Positive:** Sustains 60fps rendering on 10,000+ queued incidents during 1,000 events/sec bursts; cleanly separates time-based stream operators (RxJS) from synchronous UI state derivation (Signals); eliminates unbounded deduplication memory leaks.
- **Trade-off:** Introduces up to `100ms` visual batching latency on incoming stream telemetry (operator mutations bypass the buffer and update Signals synchronously in `<1ms`).
