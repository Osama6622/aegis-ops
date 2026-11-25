import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  IncidentSeverity,
  IncidentStatus,
  OptimisticActionKind,
} from '../../../core/models/incident.model';

export type BadgeKind = 'severity' | 'status' | 'pending';

@Component({
  selector: 'app-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [class]="variantClass()" [attr.aria-label]="ariaLabel()">
      @if (kind() === 'severity') {
        <span class="dot" aria-hidden="true"></span>
      }
      @if (kind() === 'pending') {
        <span class="spinner" aria-hidden="true"></span>
      }
      <span class="label">{{ displayText() }}</span>
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding-block: 0.15rem;
      padding-inline: 0.525rem;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      white-space: nowrap;
      border: 1px solid transparent;
      line-height: 1.3;
    }

    .dot {
      inline-size: 0.42rem;
      block-size: 0.42rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .sev-critical {
      color: var(--sev-critical-fg);
      background: var(--sev-critical-bg);
      border-color: var(--sev-critical-border);
    }
    .sev-critical .dot {
      background: var(--sev-critical-dot);
      box-shadow: 0 0 6px var(--sev-critical-dot);
      animation: pulse 1.6s infinite ease-in-out;
    }

    .sev-high {
      color: var(--sev-high-fg);
      background: var(--sev-high-bg);
      border-color: var(--sev-high-border);
    }
    .sev-high .dot {
      background: var(--sev-high-dot);
    }

    .sev-medium {
      color: var(--sev-medium-fg);
      background: var(--sev-medium-bg);
      border-color: var(--sev-medium-border);
    }
    .sev-medium .dot {
      background: var(--sev-medium-dot);
    }

    .sev-low {
      color: var(--sev-low-fg);
      background: var(--sev-low-bg);
      border-color: var(--sev-low-border);
    }
    .sev-low .dot {
      background: var(--sev-low-dot);
    }

    .status-open {
      color: var(--status-open-fg);
      background: var(--status-open-bg);
      border-color: rgba(239, 68, 68, 0.32);
    }

    .status-investigating {
      color: var(--status-investigating-fg);
      background: var(--status-investigating-bg);
      border-color: rgba(59, 130, 246, 0.35);
    }

    .status-resolved {
      color: var(--status-resolved-fg);
      background: var(--status-resolved-bg);
      border-color: rgba(34, 197, 94, 0.35);
    }

    .pending-pill {
      color: var(--accent-primary);
      background: rgba(56, 189, 248, 0.14);
      border-color: rgba(56, 189, 248, 0.42);
    }

    .spinner {
      inline-size: 0.62rem;
      block-size: 0.62rem;
      border: 1.5px solid rgba(56, 189, 248, 0.3);
      border-block-start-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.45;
        transform: scale(0.85);
      }
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class BadgeComponent {
  readonly kind = input.required<BadgeKind>();
  readonly severity = input<IncidentSeverity>();
  readonly status = input<IncidentStatus>();
  readonly pendingAction = input<OptimisticActionKind | null>(null);

  readonly displayText = computed<string>(() => {
    switch (this.kind()) {
      case 'severity':
        return this.severity() ?? 'Low';
      case 'status':
        return this.status() ?? 'Open';
      case 'pending': {
        const act = this.pendingAction();
        if (act === 'acknowledge') return 'Acking…';
        if (act === 'assign') return 'Assigning…';
        if (act === 'resolve') return 'Resolving…';
        return 'Syncing…';
      }
    }
  });

  readonly ariaLabel = computed<string>(() => {
    switch (this.kind()) {
      case 'severity':
        return `Severity: ${this.displayText()}`;
      case 'status':
        return `Status: ${this.displayText()}`;
      case 'pending':
        return `Optimistic update in progress: ${this.displayText()}`;
    }
  });

  readonly variantClass = computed<string>(() => {
    if (this.kind() === 'severity') {
      return `sev-${(this.severity() ?? 'Low').toLowerCase()}`;
    }
    if (this.kind() === 'status') {
      return `status-${(this.status() ?? 'Open').toLowerCase()}`;
    }
    return 'pending-pill';
  });
}
