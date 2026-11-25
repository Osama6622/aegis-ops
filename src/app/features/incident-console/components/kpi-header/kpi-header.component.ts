import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConnectionResilienceService } from '../../../../core/services/connection-resilience.service';
import { TelemetryStoreService } from '../../../../core/store/telemetry-store.service';
import { DirectionToggleComponent } from '../../../../shared/ui/direction-toggle/direction-toggle.component';

@Component({
  selector: 'app-kpi-header',
  standalone: true,
  imports: [DirectionToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="console-header">
      <div class="brand-row">
        <div class="brand-identity">
          <span class="brand-mark" aria-hidden="true">◆</span>
          <div>
            <div class="brand-title-line">
              <h1 class="brand-title">AEGIS OPS</h1>
              <span class="conn-pill" [class]="'conn-' + resilience.state().phase.toLowerCase()">
                <span class="conn-dot" aria-hidden="true"></span>
                {{ resilience.state().phase }}
              </span>
            </div>
            <p class="brand-subtitle">
              Real-Time Incident &amp; Backpressure Telemetry Console ·
              <span class="tabular-nums">{{ store.totalIncidentCount().toLocaleString() }}</span>
              tracked entities
            </p>
          </div>
        </div>

        <div class="header-actions">
          <app-direction-toggle />
        </div>
      </div>

      <section class="kpi-strip" aria-label="Live Operational Metrics">
        <article class="kpi-card kpi-critical">
          <span class="kpi-label">Active Critical Incidents</span>
          <div class="kpi-value-row">
            <strong class="kpi-value tabular-nums">
              {{ store.activeCriticalCount().toLocaleString() }}
            </strong>
            <span class="kpi-meta">Unresolved Sev-1</span>
          </div>
        </article>

        <article class="kpi-card kpi-mtta">
          <span class="kpi-label">Mean Time to Acknowledge</span>
          <div class="kpi-value-row">
            <strong class="kpi-value tabular-nums">{{ formattedMtta() }}</strong>
            <span class="kpi-meta">SLO Target &lt; 3m 00s</span>
          </div>
        </article>

        <article class="kpi-card kpi-throughput">
          <span class="kpi-label">Ingest Rate vs. Render Batches</span>
          <div class="kpi-value-row">
            <strong class="kpi-value tabular-nums">
              {{ store.throughput().rawEventsPerSec.toLocaleString() }}
              <small class="kpi-unit">evt/s</small>
            </strong>
            <span class="kpi-meta tabular-nums">
              {{ store.throughput().renderBatchesPerSec }} batch/s · ~{{
                store.throughput().avgBatchSize
              }}
              evt/batch
            </span>
          </div>
        </article>

        <article class="kpi-card kpi-fps">
          <span class="kpi-label">UI Frame Rate &amp; Stream Integrity</span>
          <div class="kpi-value-row">
            <strong
              class="kpi-value tabular-nums"
              [class.fps-healthy]="store.throughput().uiFps >= 50"
            >
              {{ store.throughput().uiFps }}
              <small class="kpi-unit">FPS</small>
            </strong>
            <span class="kpi-meta tabular-nums">
              Dedup: {{ store.throughput().duplicatesDropped }} · OOO:
              {{ store.throughput().outOfOrderReconciled }} · Rollbacks:
              {{ store.throughput().rollbacksTriggered }}
            </span>
          </div>
        </article>
      </section>
    </header>
  `,
  styles: `
    .console-header {
      background: var(--bg-surface);
      border-block-end: 1px solid var(--border-subtle);
      padding-block: 0.75rem;
      padding-inline: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .brand-identity {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 2rem;
      block-size: 2rem;
      border-radius: 7px;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(244, 63, 94, 0.22));
      border: 1px solid var(--border-strong);
      color: var(--accent-primary);
      font-size: 1rem;
      flex-shrink: 0;
    }

    .brand-title-line {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .brand-title {
      margin: 0;
      font-size: 0.96rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--text-primary);
    }

    .brand-subtitle {
      margin: 0;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .conn-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding-block: 0.1rem;
      padding-inline: 0.5rem;
      border-radius: 9999px;
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .conn-dot {
      inline-size: 0.42rem;
      block-size: 0.42rem;
      border-radius: 50%;
    }

    .conn-connected {
      background: rgba(34, 197, 94, 0.15);
      color: #86efac;
      border: 1px solid rgba(34, 197, 94, 0.35);
    }
    .conn-connected .conn-dot {
      background: #22c55e;
    }

    .conn-reconnecting {
      background: rgba(245, 158, 11, 0.16);
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.4);
    }
    .conn-reconnecting .conn-dot {
      background: #f59e0b;
    }

    .conn-disconnected {
      background: rgba(239, 68, 68, 0.16);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .conn-disconnected .conn-dot {
      background: #ef4444;
    }

    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.75rem;
    }

    @media (max-width: 1024px) {
      .kpi-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .kpi-card {
      background: var(--bg-surface-alt);
      border: 1px solid var(--border-subtle);
      border-inline-start-width: 3px;
      border-radius: 8px;
      padding-block: 0.55rem;
      padding-inline: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.22rem;
    }

    .kpi-critical {
      border-inline-start-color: var(--sev-critical-dot);
    }
    .kpi-mtta {
      border-inline-start-color: var(--accent-primary);
    }
    .kpi-throughput {
      border-inline-start-color: #a78bfa;
    }
    .kpi-fps {
      border-inline-start-color: var(--accent-success);
    }

    .kpi-label {
      font-size: 0.71rem;
      font-weight: 500;
      color: var(--text-secondary);
      text-align: start;
    }

    .kpi-value-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .kpi-value {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .fps-healthy {
      color: #86efac;
    }

    .kpi-unit {
      font-size: 0.74rem;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .kpi-meta {
      font-size: 0.7rem;
      color: var(--text-muted);
    }
  `,
})
export class KpiHeaderComponent {
  protected readonly store = inject(TelemetryStoreService);
  protected readonly resilience = inject(ConnectionResilienceService);

  protected readonly formattedMtta = computed<string>(() => {
    const ms = this.store.meanTimeToAckMs();
    if (ms === null) {
      return '—';
    }
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  });
}
