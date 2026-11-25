import { A11yModule } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  effect,
  inject,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="drawer-backdrop" (click)="closed.emit()" aria-hidden="true"></div>
      <aside
        class="drawer-panel"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="ariaLabel()"
        [cdkTrapFocus]="open()"
        [cdkTrapFocusAutoCapture]="true"
      >
        <header class="drawer-header">
          <div class="drawer-heading-group">
            <span class="drawer-eyebrow">{{ eyebrow() }}</span>
            <h2 class="drawer-title">{{ title() }}</h2>
          </div>
          <button
            type="button"
            class="close-btn"
            (click)="closed.emit()"
            aria-label="Close incident detail drawer (Escape)"
            title="Close (Esc)"
          >
            <span aria-hidden="true">✕</span>
            <kbd class="esc-hint">Esc</kbd>
          </button>
        </header>

        <div class="drawer-body">
          <ng-content />
        </div>
      </aside>
    }
  `,
  styles: `
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(3, 7, 18, 0.62);
      backdrop-filter: blur(2px);
      z-index: 40;
      animation: fadeIn 140ms ease-out;
    }

    .drawer-panel {
      position: fixed;
      inset-block: 0;
      inset-inline-end: 0;
      inline-size: min(34rem, 94vw);
      background: var(--bg-surface);
      border-inline-start: 1px solid var(--border-strong);
      box-shadow: -12px 0 36px rgba(0, 0, 0, 0.55);
      z-index: 50;
      display: flex;
      flex-direction: column;
      animation: slideInInlineEnd 160ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    :host-context([dir='rtl']) .drawer-panel {
      box-shadow: 12px 0 36px rgba(0, 0, 0, 0.55);
      animation: slideInInlineEndRtl 160ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .drawer-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding-block: 1rem;
      padding-inline: 1.25rem;
      border-block-end: 1px solid var(--border-subtle);
      background: var(--bg-surface-alt);
    }

    .drawer-heading-group {
      min-inline-size: 0;
    }

    .drawer-eyebrow {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.74rem;
      color: var(--accent-primary);
      margin-block-end: 0.25rem;
    }

    .drawer-title {
      margin: 0;
      font-size: 1.02rem;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.35;
    }

    .close-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding-block: 0.32rem;
      padding-inline: 0.55rem;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 120ms ease, color 120ms ease;
    }

    .close-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .esc-hint {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      padding-inline: 0.28rem;
      padding-block: 0.05rem;
      border-radius: 3px;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border-subtle);
    }

    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding-block: 1.15rem;
      padding-inline: 1.25rem;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes slideInInlineEnd {
      from {
        transform: translateX(100%);
      }
      to {
        transform: translateX(0);
      }
    }

    @keyframes slideInInlineEndRtl {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(0);
      }
    }
  `,
})
export class DrawerComponent {
  private readonly document = inject(DOCUMENT);
  private previouslyFocusedElement: HTMLElement | null = null;

  readonly open = input.required<boolean>();
  readonly title = input<string>('Details');
  readonly eyebrow = input<string>('');
  readonly ariaLabel = input<string>('Incident Detail Drawer');

  readonly closed = output<void>();

  constructor() {
    effect(() => {
      const isOpen = this.open();
      if (isOpen) {
        const active = this.document.activeElement;
        if (active instanceof HTMLElement) {
          this.previouslyFocusedElement = active;
        }
      } else if (this.previouslyFocusedElement !== null) {
        const toRestore = this.previouslyFocusedElement;
        this.previouslyFocusedElement = null;
        queueMicrotask(() => {
          if (toRestore.isConnected) {
            toRestore.focus({ preventScroll: true });
          }
        });
      }
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapePressed(event: Event): void {
    if (this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
    }
  }
}
