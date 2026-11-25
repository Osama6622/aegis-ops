import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { IncidentSeverity, IncidentStatus } from '../../../../core/models/incident.model';
import { TelemetryStoreService } from '../../../../core/store/telemetry-store.service';

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="filter-bar" aria-label="Incident Queue Multi-Facet Filters">
      <div class="search-box">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          #searchInput
          type="search"
          class="search-input"
          placeholder="Search ID, service, region, assignee, tag… ( / )"
          [value]="store.rawSearchQuery()"
          (input)="onSearchInput($event)"
          aria-label="Filter incidents by keyword"
        />
        @if (store.rawSearchQuery().length > 0) {
          <button
            type="button"
            class="clear-search-btn"
            (click)="store.setSearchQuery('', true)"
            aria-label="Clear search query"
          >
            ✕
          </button>
        }
      </div>

      <div class="facet-group" role="group" aria-label="Filter by Severity">
        <span class="facet-label">Severity:</span>
        @for (sev of severities; track sev) {
          <button
            type="button"
            class="facet-pill"
            [class.selected]="store.selectedSeverities().includes(sev)"
            [attr.aria-pressed]="store.selectedSeverities().includes(sev)"
            (click)="store.toggleSeverityFilter(sev)"
          >
            {{ sev }}
          </button>
        }
      </div>

      <div class="facet-group" role="group" aria-label="Filter by Status">
        <span class="facet-label">Status:</span>
        @for (st of statuses; track st) {
          <button
            type="button"
            class="facet-pill"
            [class.selected]="store.selectedStatuses().includes(st)"
            [attr.aria-pressed]="store.selectedStatuses().includes(st)"
            (click)="store.toggleStatusFilter(st)"
          >
            {{ st }}
          </button>
        }
      </div>

      <div class="filter-meta">
        <span class="result-counter tabular-nums">
          Showing <strong>{{ store.filteredIncidents().length.toLocaleString() }}</strong> of
          {{ store.totalIncidentCount().toLocaleString() }}
        </span>

        @if (hasActiveFilters()) {
          <button type="button" class="reset-btn" (click)="store.resetFilters()">
            Reset
          </button>
        }

        <div class="kbd-legend" aria-hidden="true">
          <span><kbd>J</kbd>/<kbd>K</kbd> Move</span>
          <span><kbd>Enter</kbd> Drawer</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </section>
  `,
  styles: `
    .filter-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding-block: 0.55rem;
      padding-inline: 1.25rem;
      background: var(--bg-surface);
      border-block-end: 1px solid var(--border-subtle);
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1 1 16rem;
      max-inline-size: 23rem;
    }

    .search-icon {
      position: absolute;
      inset-inline-start: 0.65rem;
      color: var(--text-muted);
      font-size: 0.9rem;
      pointer-events: none;
    }

    .search-input {
      inline-size: 100%;
      padding-block: 0.36rem;
      padding-inline-start: 1.85rem;
      padding-inline-end: 1.8rem;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-size: 0.78rem;
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    .clear-search-btn {
      position: absolute;
      inset-inline-end: 0.4rem;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding-inline: 0.25rem;
      font-size: 0.75rem;
    }

    .facet-group {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      flex-wrap: wrap;
    }

    .facet-label {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-inline-end: 0.15rem;
    }

    .facet-pill {
      padding-block: 0.24rem;
      padding-inline: 0.55rem;
      border-radius: 9999px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-canvas);
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 110ms ease;
    }

    .facet-pill.selected {
      background: var(--bg-elevated);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }

    .filter-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-inline-start: auto;
      flex-wrap: wrap;
    }

    .result-counter {
      font-size: 0.74rem;
      color: var(--text-secondary);
    }

    .reset-btn {
      padding-block: 0.22rem;
      padding-inline: 0.5rem;
      border-radius: 5px;
      border: 1px solid var(--border-strong);
      background: transparent;
      color: var(--accent-primary);
      font-size: 0.72rem;
      cursor: pointer;
    }

    .kbd-legend {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    @media (max-width: 1180px) {
      .kbd-legend {
        display: none;
      }
    }

    kbd {
      font-family: var(--font-mono);
      font-size: 0.66rem;
      padding-inline: 0.28rem;
      padding-block: 0.06rem;
      border-radius: 3px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }
  `,
})
export class FilterBarComponent {
  protected readonly store = inject(TelemetryStoreService);

  private readonly searchInputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly severities: readonly IncidentSeverity[] = ['Critical', 'High', 'Medium', 'Low'];
  protected readonly statuses: readonly IncidentStatus[] = ['Open', 'Investigating', 'Resolved'];

  protected readonly hasActiveFilters = computed<boolean>(
    () =>
      this.store.selectedSeverities().length < 4 ||
      this.store.selectedStatuses().length < 3 ||
      this.store.rawSearchQuery().trim().length > 0,
  );

  focusSearchInput(): void {
    this.searchInputRef()?.nativeElement.focus();
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.store.setSearchQuery(target?.value ?? '');
  }
}
