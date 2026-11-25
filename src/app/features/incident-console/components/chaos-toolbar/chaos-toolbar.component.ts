import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  STREAM_RATE_EVENTS_PER_SEC,
  StreamRatePreset,
} from '../../../../core/models/incident.model';
import { ConnectionResilienceService } from '../../../../core/services/connection-resilience.service';
import { IncidentApiSimulatorService } from '../../../../core/services/incident-api-simulator.service';
import { IncidentStreamSimulatorService } from '../../../../core/services/incident-stream-simulator.service';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-chaos-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="chaos-bar" aria-label="Stream Velocity and Chaos Controls">
      <div class="rate-control" role="group" aria-label="Telemetry Stream Rate">
        <span class="group-label">Stream Rate:</span>
        @for (preset of presets; track preset) {
          <button
            type="button"
            class="rate-btn"
            [class.active]="simulator.ratePreset() === preset"
            [attr.aria-pressed]="simulator.ratePreset() === preset"
            (click)="simulator.setRatePreset(preset)"
          >
            <span>{{ preset }}</span>
            <small class="tabular-nums">({{ rateMap[preset] }}/s)</small>
          </button>
        }
      </div>

      <div class="chaos-actions" role="group" aria-label="Chaos Engineering Fault Injection">
        <span class="group-label">Chaos Controls:</span>

        <button
          type="button"
          class="chaos-btn"
          [class.danger-active]="!resilience.isConnected()"
          (click)="resilience.toggleDisconnectSimulation()"
        >
          @if (resilience.isConnected()) {
            ⚡ Simulate Disconnect
          } @else {
            ↻ Reconnect Stream Now
          }
        </button>

        <button
          type="button"
          class="chaos-btn"
          (click)="triggerAnomalyBurst()"
          title="Immediately emit 5 duplicate eventId frames + 5 stale sequence out-of-order frames"
        >
          ⇄ Inject Out-of-Order / Duplicate Burst
        </button>

        <button
          type="button"
          class="chaos-btn"
          [class.warn-active]="simulator.chaosAnomaliesEnabled()"
          [attr.aria-pressed]="simulator.chaosAnomaliesEnabled()"
          (click)="simulator.toggleContinuousChaos()"
          title="Continuously inject ~16% duplicate and out-of-order frames into the live stream"
        >
          Continuous Chaos: {{ simulator.chaosAnomaliesEnabled() ? 'ON' : 'OFF' }}
        </button>

        <button
          type="button"
          class="chaos-btn"
          [class.warn-active]="apiSimulator.forceNextFailure()"
          [attr.aria-pressed]="apiSimulator.forceNextFailure()"
          (click)="toggleForceFailure()"
          title="Guarantee the next Acknowledge/Assign/Resolve call fails so rollback can be inspected deterministically (default failure rate is ~15%)"
        >
          Force Next Rollback: {{ apiSimulator.forceNextFailure() ? 'ARMED' : '15% Auto' }}
        </button>
      </div>
    </section>

    @if (!resilience.isConnected()) {
      <div class="backoff-banner" role="alert" aria-live="assertive">
        <div class="banner-main">
          <span class="banner-badge">TRANSPORT OFFLINE</span>
          <span class="banner-text">
            {{ resilience.state().reason }} —
            @if (resilience.state().phase === 'Reconnecting') {
              Exponential Backoff Attempt
              <strong class="tabular-nums">#{{ resilience.state().attempt }}</strong> · Retrying in
              <strong class="tabular-nums">
                {{ (resilience.state().nextRetryInMs / 1000).toFixed(1) }}s
              </strong>
              <span class="banner-formula tabular-nums">
                (window {{ resilience.state().currentBackoffDelayMs }}ms)
              </span>
            } @else {
              Automatic reconnection paused.
            }
          </span>
        </div>

        <button
          type="button"
          class="banner-reconnect-btn"
          (click)="resilience.reconnectImmediately()"
        >
          Force Reconnect
        </button>
      </div>
    }
  `,
  styles: `
    .chaos-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding-block: 0.55rem;
      padding-inline: 1.25rem;
      background: var(--bg-surface-alt);
      border-block-end: 1px solid var(--border-subtle);
    }

    .rate-control,
    .chaos-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .group-label {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-inline-end: 0.25rem;
    }

    .rate-btn,
    .chaos-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding-block: 0.3rem;
      padding-inline: 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }

    .rate-btn:hover,
    .chaos-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }

    .rate-btn.active {
      background: rgba(56, 189, 248, 0.16);
      color: var(--accent-primary);
      border-color: rgba(56, 189, 248, 0.5);
      font-weight: 600;
    }

    .rate-btn small {
      font-size: 0.68rem;
      opacity: 0.8;
    }

    .chaos-btn.danger-active {
      background: rgba(239, 68, 68, 0.18);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.5);
    }

    .chaos-btn.warn-active {
      background: rgba(245, 158, 11, 0.18);
      color: #fcd34d;
      border-color: rgba(245, 158, 11, 0.5);
    }

    .backoff-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding-block: 0.5rem;
      padding-inline: 1.25rem;
      background: linear-gradient(90deg, rgba(153, 27, 27, 0.38), rgba(120, 53, 15, 0.34));
      border-block-end: 1px solid rgba(248, 113, 113, 0.45);
      color: #fecaca;
      font-size: 0.78rem;
    }

    .banner-main {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      flex-wrap: wrap;
    }

    .banner-badge {
      padding-block: 0.12rem;
      padding-inline: 0.45rem;
      border-radius: 4px;
      background: rgba(239, 68, 68, 0.32);
      border: 1px solid rgba(248, 113, 113, 0.55);
      font-family: var(--font-mono);
      font-size: 0.68rem;
      font-weight: 700;
      color: #fee2e2;
    }

    .banner-formula {
      color: #fde68a;
      font-size: 0.72rem;
      margin-inline-start: 0.25rem;
    }

    .banner-reconnect-btn {
      padding-block: 0.28rem;
      padding-inline: 0.7rem;
      border-radius: 5px;
      border: 1px solid rgba(252, 165, 165, 0.55);
      background: rgba(239, 68, 68, 0.25);
      color: #fff1f2;
      font-size: 0.74rem;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }

    .banner-reconnect-btn:hover {
      background: rgba(239, 68, 68, 0.42);
    }
  `,
})
export class ChaosToolbarComponent {
  protected readonly simulator = inject(IncidentStreamSimulatorService);
  protected readonly resilience = inject(ConnectionResilienceService);
  protected readonly apiSimulator = inject(IncidentApiSimulatorService);
  private readonly toastService = inject(ToastService);

  protected readonly presets: readonly StreamRatePreset[] = ['Paused', 'Normal', 'Spike', 'Burst'];
  protected readonly rateMap = STREAM_RATE_EVENTS_PER_SEC;

  protected triggerAnomalyBurst(): void {
    if (!this.resilience.isConnected()) {
      this.toastService.push({
        variant: 'warning',
        title: 'Stream Currently Disconnected',
        detail: 'Reconnect the transport first so injected anomaly frames reach the ingestion pipeline.',
      });
      return;
    }

    this.simulator.injectChaosAnomalyBurst(5);
    this.toastService.push({
      variant: 'info',
      title: 'Injected Chaos Packet Burst',
      detail: 'Dispatched 5 duplicate eventId replays and 5 out-of-order sequence frames into the 100ms buffer.',
      durationMs: 3200,
    });
  }

  protected toggleForceFailure(): void {
    this.apiSimulator.forceNextFailure.update((armed) => !armed);
  }
}
