import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DirectionService } from '../../../core/services/direction.service';

@Component({
  selector: 'app-direction-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="dir-btn"
      (click)="directionService.toggleDirection()"
      [attr.aria-pressed]="directionService.dir() === 'rtl'"
      [attr.aria-label]="
        'Toggle layout direction. Current direction: ' + directionService.dir().toUpperCase()
      "
      title="Switch between LTR and RTL logical layout"
    >
      <span class="dir-icon" aria-hidden="true">⇄</span>
      <span class="dir-code tabular-nums">dir="{{ directionService.dir() }}"</span>
    </button>
  `,
  styles: `
    .dir-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding-block: 0.38rem;
      padding-inline: 0.65rem;
      border-radius: 6px;
      border: 1px solid var(--border-strong);
      background: var(--bg-elevated);
      color: var(--text-primary);
      font-size: 0.76rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .dir-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }

    .dir-btn[aria-pressed='true'] {
      border-color: var(--accent-primary);
      background: rgba(56, 189, 248, 0.14);
      color: var(--accent-primary);
    }

    .dir-icon {
      font-size: 0.85rem;
      line-height: 1;
    }
  `,
})
export class DirectionToggleComponent {
  protected readonly directionService = inject(DirectionService);
}
