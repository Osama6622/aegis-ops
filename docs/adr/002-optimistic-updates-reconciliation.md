# ADR 002: Optimistic Operator Mutations, Concurrent Telemetry Baseline Advancement, and Causal Reconciliation

- **Status:** Accepted
- **Date:** 2026-11-25
- **Context:** Real-Time Operational & Incident Management Console (`Aegis Ops`)

## Context & Problem Statement

Incident responders performing high-urgency triage (**Acknowledge**, **Assign**, **Resolve**) expect instantaneous UI feedback (`<1ms`), even when upstream incident-management APIs exhibit `300–800ms` write latency and transient write conflicts (`~15%` failure rate).

Naive snapshot-rollback implementations suffer from two subtle race conditions in streaming consoles:

1. **Stale Rollback Clobbering:** An operator clicks *Acknowledge* at `t = 0ms` (capturing `snapshot_v2`). At `t = 250ms`, valid live telemetry `seq #3` arrives with critical P99 latency escalation. At `t = 600ms`, the HTTP *Acknowledge* call fails with `503`. Rolling back naively to `snapshot_v2` erases `seq #3`'s live telemetry update.
2. **Out-of-Order Partition Arrivals:** Distributed collectors frequently deliver delayed frames (`event.sequence <= incident.lastSequence`) that would otherwise regress an `Investigating` or `Resolved` incident back to `Open`.

## Decision

We implement **Overlay-Isolated Optimistic Reconciliation** coupled with **Per-Incident Monotonic Causal Sequencing**:

1. **Authoritative `serverBaseline` Tracking (`inFlightMutations`):**
   - When an operator triggers `acknowledge`, `assign`, or `resolve`, `TelemetryStoreService` records an `OptimisticMutation` containing `serverBaseline: Incident` and immediately projects the optimistic status/assignee + `pendingAction` badge into `incidentMapState`.
   - If forward stream telemetry (`event.sequence > lastSequence`) arrives while the HTTP request is still in flight, `reconcileTelemetryBatch()` **advances `mutation.serverBaseline`** with the new telemetry *and* updates live non-conflicting metrics (`p99LatencyMs`, `errorRatePct`, `severity`) on screen without overwriting the operator's optimistic status.
   - If the HTTP write fails (`~15%`), the store restores `active.serverBaseline` (preserving all concurrent stream updates!), appends a `'rollback'` audit entry, and emits a non-intrusive error toast via `ToastService`.
2. **Causal Sequence Gate (`lastSequence`):**
   - Any non-duplicate event with `event.sequence <= existing.lastSequence` is classified as out-of-order: entity fields (`status`, `severity`, `assignee`, `metrics`) are never regressed, while the frame is preserved in `incident.timeline` sorted by `(sequence, timestamp)` as `reconciled-out-of-order`.

## Consequences

- **Positive:** `<1ms` perceived action latency; zero data loss when concurrent stream updates overlap failed HTTP writes; deterministic immunity to delayed/replayed broker packets; 100% pure unit-testable reducer functions in `incident-reconciler.ts`.
- **Trade-off:** Serializes one active mutation per incident (`pendingAction !== null` disables duplicate clicks on the same row until settled) to keep per-entity conflict semantics unambiguous for operators.
