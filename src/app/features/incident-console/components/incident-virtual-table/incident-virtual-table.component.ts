import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { Incident, IncidentSortField } from '../../../../core/models/incident.model';
import { TelemetryStoreService } from '../../../../core/store/telemetry-store.service';
import { BadgeComponent } from '../../../../shared/ui/badge/badge.component';

@Component({
  selector: 'app-incident-virtual-table',
  standalone: true,
  imports: [ScrollingModule, DatePipe, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid-shell" role="grid" aria-label="High-Density Operational Incident Queue">
      <div class="grid-header" role="row">
        <button
          type="button"
          class="col-header col-id"
          role="columnheader"
          [attr.aria-sort]="ariaSort('createdAt')"
          (click)="store.setSorting('createdAt')"
        >
          ID {{ sortGlyph('createdAt') }}
        </button>

        <button
          type="button"
          class="col-header col-severity"
          role="columnheader"
          [attr.aria-sort]="ariaSort('severity')"
          (click)="store.setSorting('severity')"
        >
          Severity {{ sortGlyph('severity') }}
        </button>

        <div class="col-header col-summary" role="columnheader">Incident &amp; Service</div>

        <div class="col-header col-status" role="columnheader">Status</div>

        <button
          type="button"
          class="col-header col-telemetry"
          role="columnheader"
          [attr.aria-sort]="ariaSort('p99LatencyMs')"
          (click)="store.setSorting('p99LatencyMs')"
        >
          P99 / Error% {{ sortGlyph('p99LatencyMs') }}
        </button>

        <div class="col-header col-assignee" role="columnheader">Assignee</div>

        <button
          type="button"
          class="col-header col-updated"
          role="columnheader"
          [attr.aria-sort]="ariaSort('updatedAt')"
          (click)="store.setSorting('updatedAt')"
        >
          Updated {{ sortGlyph('updatedAt') }}
        </button>

        <div class="col-header col-actions" role="columnheader">Quick Actions</div>
      </div>

      @if (store.filteredIncidents().length === 0) {
        <div class="empty-state" role="status">
          <p class="empty-title">No incidents match the active multi-facet filters.</p>
          <button type="button" class="empty-reset-btn" (click)="store.resetFilters()">
            Reset All Filters
          </button>
        </div>
      } @else {
        <cdk-virtual-scroll-viewport
          class="grid-viewport"
          [itemSize]="rowHeightPx"
          [minBufferPx]="rowHeightPx * 10"
          [maxBufferPx]="rowHeightPx * 20"
        >
          <div
            *cdkVirtualFor="let incident of store.filteredIncidents(); trackBy: trackByIncidentId"
            class="grid-row"
            [class.row-selected]="store.selectedIncidentId() === incident.id"
            [class.row-critical]="
              incident.severity === 'Critical' && incident.status !== 'Resolved'
            "
            role="row"
            tabindex="-1"
            [attr.aria-selected]="store.selectedIncidentId() === incident.id"
            (click)="onRowClick(incident)"
            (dblclick)="store.openDetailDrawer(incident.id)"
          >
            <div class="cell col-id tabular-nums" role="gridcell">
              <span class="id-code">{{ incident.id }}</span>
              <span class="seq-tag">v{{ incident.lastSequence }}</span>
            </div>

            <div class="cell col-severity" role="gridcell">
              <app-badge kind="severity" [severity]="incident.severity" />
            </div>

            <div class="cell col-summary" role="gridcell">
              <div class="incident-title" [title]="incident.title">{{ incident.title }}</div>
              <div class="incident-sub">
                <span class="service-chip">{{ incident.service }}</span>
                <span class="region-text">{{ incident.region }}</span>
              </div>
            </div>

            <div class="cell col-status" role="gridcell">
              @if (incident.pendingAction !== null) {
                <app-badge kind="pending" [pendingAction]="incident.pendingAction" />
              } @else {
                <app-badge kind="status" [status]="incident.status" />
              }
            </div>

            <div class="cell col-telemetry tabular-nums" role="gridcell">
              <span
                class="latency-val"
                [class.latency-hot]="incident.metrics.p99LatencyMs >= 800"
              >
                {{ incident.metrics.p99LatencyMs }}ms
              </span>
              <span class="err-val">{{ incident.metrics.errorRatePct }}% err</span>
            </div>

            <div class="cell col-assignee" role="gridcell">
              @if (incident.assignee) {
                <span class="assignee-tag">{{ incident.assignee }}</span>
              } @else {
                <span class="unassigned-tag">Unassigned</span>
              }
            </div>

            <div class="cell col-updated tabular-nums" role="gridcell">
              {{ incident.updatedAt | date: 'HH:mm:ss' }}
            </div>

            <div class="cell col-actions" role="gridcell" (click)="$event.stopPropagation()">
              @if (incident.status === 'Open') {
                <button
                  type="button"
                  class="row-action-btn ack"
                  [disabled]="incident.pendingAction !== null"
                  (click)="store.acknowledgeIncident(incident.id)"
                  [attr.aria-label]="'Acknowledge ' + incident.id"
                >
                  Ack
                </button>
              }
              @if (incident.status !== 'Resolved') {
                <button
                  type="button"
                  class="row-action-btn resolve"
                  [disabled]="incident.pendingAction !== null"
                  (click)="store.resolveIncident(incident.id)"
                  [attr.aria-label]="'Resolve ' + incident.id"
                >
                  Resolve
                </button>
              }
              <button
                type="button"
                class="row-action-btn inspect"
                (click)="store.openDetailDrawer(incident.id)"
                [attr.aria-label]="'Open details for ' + incident.id"
              >
                Inspect
              </button>
            </div>
          </div>
        </cdk-virtual-scroll-viewport>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-block-size: 0;
    }

    .grid-shell {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-block-size: 0;
      background: var(--bg-canvas);
    }

    .grid-header,
    .grid-row {
      display: grid;
      grid-template-columns:
        7.5rem
        6.8rem
        minmax(15rem, 1fr)
        7.8rem
        8.6rem
        8.2rem
        5.8rem
        11.2rem;
      align-items: center;
      gap: 0.65rem;
      padding-inline: 1.25rem;
    }

    .grid-header {
      block-size: 2.35rem;
      background: var(--bg-surface-alt);
      border-block-end: 1px solid var(--border-strong);
      font-size: 0.71rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .col-header {
      background: transparent;
      border: none;
      padding: 0;
      text-align: start;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
    }

    button.col-header {
      cursor: pointer;
    }
    button.col-header:hover {
      color: var(--text-primary);
    }

    .grid-viewport {
      flex: 1;
      block-size: 100%;
    }

    .grid-row {
      block-size: 52px;
      border-block-end: 1px solid rgba(30, 45, 71, 0.65);
      border-inline-start: 3px solid transparent;
      background: var(--bg-canvas);
      cursor: pointer;
      transition: background 80ms ease;
    }

    .grid-row:hover {
      background: var(--bg-surface);
    }

    .grid-row.row-critical {
      border-inline-start-color: rgba(244, 63, 94, 0.7);
    }

    .grid-row.row-selected {
      background: var(--bg-selected);
      border-inline-start-color: var(--accent-primary);
    }

    .cell {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: start;
    }

    .col-id {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
    }

    .id-code {
      font-size: 0.77rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .seq-tag {
      font-size: 0.65rem;
      color: var(--text-muted);
    }

    .incident-title {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .incident-sub {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .service-chip {
      font-family: var(--font-mono);
      color: var(--accent-primary);
    }

    .col-telemetry {
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .latency-val {
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .latency-hot {
      color: var(--sev-critical-fg);
    }

    .err-val {
      font-size: 0.68rem;
      color: var(--text-muted);
    }

    .assignee-tag {
      font-family: var(--font-mono);
      font-size: 0.73rem;
      color: var(--text-secondary);
    }

    .unassigned-tag {
      font-size: 0.72rem;
      font-style: italic;
      color: var(--text-muted);
    }

    .col-updated {
      font-size: 0.74rem;
      color: var(--text-secondary);
    }

    .col-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.3rem;
    }

    .row-action-btn {
      padding-block: 0.22rem;
      padding-inline: 0.48rem;
      border-radius: 5px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface-alt);
      color: var(--text-secondary);
      font-size: 0.7rem;
      font-weight: 500;
      cursor: pointer;
    }

    .row-action-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }

    .row-action-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .row-action-btn.ack {
      border-color: rgba(56, 189, 248, 0.35);
      color: var(--accent-primary);
    }

    .row-action-btn.resolve {
      border-color: rgba(34, 197, 94, 0.35);
      color: #86efac;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      color: var(--text-secondary);
    }

    .empty-reset-btn {
      padding-block: 0.4rem;
      padding-inline: 0.85rem;
      border-radius: 6px;
      border: 1px solid var(--border-strong);
      background: var(--bg-elevated);
      color: var(--accent-primary);
      cursor: pointer;
    }
  `,
})
export class IncidentVirtualTableComponent {
  protected readonly store = inject(TelemetryStoreService);
  private readonly viewportRef = viewChild(CdkVirtualScrollViewport);

  protected readonly rowHeightPx = 52;

  protected trackByIncidentId(_index: number, item: Incident): string {
    return item.id;
  }

  protected onRowClick(incident: Incident): void {
    this.store.selectIncident(incident.id, true);
  }

  protected sortGlyph(field: IncidentSortField): string {
    if (this.store.sortBy() !== field) {
      return '↕';
    }
    return this.store.sortDirection() === 'desc' ? '↓' : '↑';
  }

  protected ariaSort(field: IncidentSortField): 'ascending' | 'descending' | 'none' {
    if (this.store.sortBy() !== field) {
      return 'none';
    }
    return this.store.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  moveSelectionBy(delta: number): void {
    const items = this.store.filteredIncidents();
    if (items.length === 0) {
      return;
    }

    const currentId = this.store.selectedIncidentId();
    const currentIndex = currentId !== null ? items.findIndex((item) => item.id === currentId) : -1;

    const nextIndex =
      currentIndex === -1
        ? 0
        : Math.max(0, Math.min(items.length - 1, currentIndex + delta));

    const target = items[nextIndex];
    this.store.selectIncident(target.id, false);
    this.ensureIndexVisible(nextIndex);
  }

  private ensureIndexVisible(index: number): void {
    const viewport = this.viewportRef();
    if (!viewport) {
      return;
    }

    const viewportSize = viewport.getViewportSize();
    if (viewportSize <= 0) {
      return;
    }

    const scrollOffset = viewport.measureScrollOffset('top');
    const rowTop = index * this.rowHeightPx;
    const rowBottom = rowTop + this.rowHeightPx;

    if (rowTop < scrollOffset) {
      viewport.scrollToIndex(index, 'auto');
    } else if (rowBottom > scrollOffset + viewportSize) {
      const firstVisibleForBottomAlign = Math.max(
        0,
        index - Math.floor(viewportSize / this.rowHeightPx) + 1,
      );
      viewport.scrollToIndex(firstVisibleForBottomAlign, 'auto');
    }
  }
}
