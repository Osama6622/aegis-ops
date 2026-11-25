import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TelemetryStoreService } from '../../../../core/store/telemetry-store.service';
import { BadgeComponent } from '../../../../shared/ui/badge/badge.component';
import { DrawerComponent } from '../../../../shared/ui/drawer/drawer.component';

const ON_CALL_ROSTER: readonly string[] = [
  'sara.khalil',
  'alex.chen',
  'omar.mansour',
  'elena.rostova',
  'devon.park',
];

@Component({
  selector: 'app-incident-detail-drawer',
  standalone: true,
  imports: [DatePipe, DrawerComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let incident = store.selectedIncident();
    <app-drawer
      [open]="store.isDrawerOpen() && incident !== null"
      [eyebrow]="incident ? incident.id + ' · ' + incident.service + ' · ' + incident.region : ''"
      [title]="incident?.title ?? 'Incident Details'"
      (closed)="store.closeDetailDrawer()"
    >
      @if (incident) {
        <div class="drawer-stack">
          <div class="badge-bar">
            <app-badge kind="severity" [severity]="incident.severity" />
            <app-badge kind="status" [status]="incident.status" />
            @if (incident.pendingAction !== null) {
              <app-badge kind="pending" [pendingAction]="incident.pendingAction" />
            }
            <span class="seq-pill tabular-nums">Causal Seq #{{ incident.lastSequence }}</span>
          </div>

          <section class="action-card" aria-label="Optimistic Operator Controls">
            <div class="section-header">
              <h3>Operator Response (Optimistic UI)</h3>
              <span class="sim-hint">300–800ms latency · ~15% rollback simulation</span>
            </div>

            <div class="action-buttons">
              <button
                type="button"
                class="op-btn primary"
                [disabled]="incident.pendingAction !== null || incident.status !== 'Open'"
                (click)="store.acknowledgeIncident(incident.id)"
              >
                Acknowledge Incident
              </button>

              <button
                type="button"
                class="op-btn resolve"
                [disabled]="incident.pendingAction !== null || incident.status === 'Resolved'"
                (click)="store.resolveIncident(incident.id)"
              >
                Mark Resolved
              </button>
            </div>

            <div class="assign-row">
              <label class="assign-label" for="assignee-select">Assign On-Call Engineer:</label>
              <select
                id="assignee-select"
                class="assign-select"
                [disabled]="incident.pendingAction !== null"
                [value]="incident.assignee ?? ''"
                (change)="onAssigneeChange(incident.id, $event)"
              >
                <option value="" disabled>Select responder…</option>
                @for (engineer of roster; track engineer) {
                  <option [value]="engineer">{{ engineer }}</option>
                }
              </select>
            </div>
          </section>

          <section class="telemetry-grid" aria-label="Live Service Telemetry">
            <div class="metric-tile">
              <span class="tile-label">P99 Latency</span>
              <strong class="tile-value tabular-nums">{{ incident.metrics.p99LatencyMs }}ms</strong>
            </div>
            <div class="metric-tile">
              <span class="tile-label">Error Rate</span>
              <strong class="tile-value tabular-nums">{{ incident.metrics.errorRatePct }}%</strong>
            </div>
            <div class="metric-tile">
              <span class="tile-label">Affected Traffic</span>
              <strong class="tile-value tabular-nums">{{ incident.metrics.affectedRps }} rps</strong>
            </div>
          </section>

          <section class="metadata-list" aria-label="Incident Timestamps and Tags">
            <div class="meta-row">
              <span>Opened At</span>
              <span class="tabular-nums">{{ incident.createdAt | date: 'mediumTime' }}</span>
            </div>
            <div class="meta-row">
              <span>Acknowledged At</span>
              <span class="tabular-nums">
                {{ incident.acknowledgedAt ? (incident.acknowledgedAt | date: 'mediumTime') : 'Pending' }}
              </span>
            </div>
            <div class="meta-row">
              <span>Tags</span>
              <div class="tag-row">
                @for (tag of incident.tags; track tag) {
                  <span class="tag-chip">#{{ tag }}</span>
                }
              </div>
            </div>
          </section>

          <section class="timeline-section" aria-label="Causal Reconciliation Audit Log">
            <h3 class="timeline-heading">Causal Event &amp; Reconciliation Log</h3>
            <ol class="timeline-list">
              @for (entry of incident.timeline; track entry.id) {
                <li class="timeline-item" [class]="'entry-' + entry.kind">
                  <div class="entry-meta">
                    <span class="entry-seq tabular-nums">seq #{{ entry.sequence }}</span>
                    <span class="entry-actor">{{ entry.actor }}</span>
                    <span class="entry-time tabular-nums">
                      {{ entry.timestamp | date: 'HH:mm:ss.SSS' }}
                    </span>
                  </div>
                  <p class="entry-summary">{{ entry.summary }}</p>
                </li>
              }
            </ol>
          </section>
        </div>
      }
    </app-drawer>
  `,
  styles: `
    .drawer-stack {
      display: flex;
      flex-direction: column;
      gap: 1.1rem;
    }

    .badge-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .seq-pill {
      margin-inline-start: auto;
      font-size: 0.72rem;
      color: var(--text-muted);
      padding-block: 0.14rem;
      padding-inline: 0.45rem;
      border-radius: 4px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
    }

    .action-card {
      padding-block: 0.9rem;
      padding-inline: 1rem;
      border-radius: 8px;
      background: var(--bg-surface-alt);
      border: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .section-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .section-header h3,
    .timeline-heading {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }

    .sim-hint {
      font-size: 0.69rem;
      color: var(--text-muted);
    }

    .action-buttons {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    .op-btn {
      flex: 1 1 9rem;
      padding-block: 0.48rem;
      padding-inline: 0.85rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: opacity 120ms ease, transform 80ms ease;
    }

    .op-btn:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }

    .op-btn.primary {
      background: rgba(56, 189, 248, 0.18);
      border-color: rgba(56, 189, 248, 0.5);
      color: var(--accent-primary);
    }

    .op-btn.resolve {
      background: rgba(34, 197, 94, 0.18);
      border-color: rgba(34, 197, 94, 0.5);
      color: #86efac;
    }

    .assign-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .assign-label {
      font-size: 0.76rem;
      color: var(--text-secondary);
    }

    .assign-select {
      flex: 1 1 11rem;
      padding-block: 0.36rem;
      padding-inline: 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border-strong);
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-size: 0.78rem;
    }

    .telemetry-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
    }

    .metric-tile {
      padding-block: 0.65rem;
      padding-inline: 0.75rem;
      border-radius: 7px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .tile-label {
      font-size: 0.69rem;
      color: var(--text-muted);
    }

    .tile-value {
      font-size: 1rem;
      color: var(--text-primary);
    }

    .metadata-list {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding-block: 0.65rem;
      padding-inline: 0.85rem;
      border-radius: 7px;
      background: var(--bg-surface-alt);
      border: 1px solid var(--border-subtle);
      font-size: 0.76rem;
    }

    .meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      color: var(--text-secondary);
    }

    .tag-row {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }

    .tag-chip {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      padding-inline: 0.4rem;
      padding-block: 0.08rem;
      border-radius: 4px;
      background: var(--bg-elevated);
      color: var(--accent-primary);
    }

    .timeline-section {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .timeline-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .timeline-item {
      padding-block: 0.55rem;
      padding-inline: 0.75rem;
      border-radius: 6px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-inline-start-width: 3px;
    }

    .entry-operator-action {
      border-inline-start-color: var(--accent-primary);
    }

    .entry-reconciled-out-of-order {
      border-inline-start-color: var(--accent-warning);
      background: rgba(245, 158, 11, 0.07);
    }

    .entry-rollback {
      border-inline-start-color: var(--accent-danger);
      background: rgba(239, 68, 68, 0.08);
    }

    .entry-telemetry-update,
    .entry-ingested {
      border-inline-start-color: var(--border-strong);
    }

    .entry-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.69rem;
      color: var(--text-muted);
      margin-block-end: 0.2rem;
    }

    .entry-seq {
      color: var(--accent-primary);
      font-weight: 600;
    }

    .entry-time {
      margin-inline-start: auto;
    }

    .entry-summary {
      margin: 0;
      font-size: 0.76rem;
      color: var(--text-primary);
      line-height: 1.38;
    }
  `,
})
export class IncidentDetailDrawerComponent {
  protected readonly store = inject(TelemetryStoreService);
  protected readonly roster = ON_CALL_ROSTER;

  protected onAssigneeChange(incidentId: string, event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    const assignee = select?.value;
    if (assignee) {
      this.store.assignIncident(incidentId, assignee);
    }
  }
}
