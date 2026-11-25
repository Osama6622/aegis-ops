import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  inject,
  viewChild,
} from '@angular/core';
import { DirectionService } from '../../core/services/direction.service';
import { TelemetryStoreService } from '../../core/store/telemetry-store.service';
import { ToastStackComponent } from '../../shared/ui/toast-stack/toast-stack.component';
import { ChaosToolbarComponent } from './components/chaos-toolbar/chaos-toolbar.component';
import { FilterBarComponent } from './components/filter-bar/filter-bar.component';
import { IncidentDetailDrawerComponent } from './components/incident-detail-drawer/incident-detail-drawer.component';
import { IncidentVirtualTableComponent } from './components/incident-virtual-table/incident-virtual-table.component';
import { KpiHeaderComponent } from './components/kpi-header/kpi-header.component';

@Component({
  selector: 'app-incident-console-page',
  standalone: true,
  imports: [
    KpiHeaderComponent,
    ChaosToolbarComponent,
    FilterBarComponent,
    IncidentVirtualTableComponent,
    IncidentDetailDrawerComponent,
    ToastStackComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="console-viewport" [attr.dir]="directionService.dir()">
      <app-kpi-header />
      <app-chaos-toolbar />
      <app-filter-bar />
      <app-incident-virtual-table />
      <app-incident-detail-drawer />
      <app-toast-stack />
    </main>
  `,
  styles: `
    :host {
      display: block;
      block-size: 100dvh;
    }

    .console-viewport {
      display: flex;
      flex-direction: column;
      block-size: 100dvh;
      inline-size: 100%;
      overflow: hidden;
      background: var(--bg-canvas);
      color: var(--text-primary);
    }
  `,
})
export class IncidentConsolePageComponent implements OnInit {
  protected readonly store = inject(TelemetryStoreService);
  protected readonly directionService = inject(DirectionService);

  private readonly virtualTableRef = viewChild(IncidentVirtualTableComponent);
  private readonly filterBarRef = viewChild(FilterBarComponent);

  ngOnInit(): void {
    this.store.initializeConsole(10_000);
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (this.isEditableElement(event.target)) {
      if (event.key === 'Escape' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    switch (event.key) {
      case 'j':
      case 'J':
      case 'ArrowDown':
        event.preventDefault();
        this.virtualTableRef()?.moveSelectionBy(1);
        break;
      case 'k':
      case 'K':
      case 'ArrowUp':
        event.preventDefault();
        this.virtualTableRef()?.moveSelectionBy(-1);
        break;
      case 'Enter':
        if (!this.store.isDrawerOpen() && this.store.selectedIncidentId() !== null) {
          event.preventDefault();
          this.store.openDetailDrawer();
        }
        break;
      case 'Escape':
        if (this.store.isDrawerOpen()) {
          event.preventDefault();
          this.store.closeDetailDrawer();
        }
        break;
      case '/':
        event.preventDefault();
        this.filterBarRef()?.focusSearchInput();
        break;
    }
  }

  private isEditableElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }
}
