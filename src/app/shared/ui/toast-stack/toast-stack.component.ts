import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="toast-viewport"
      aria-label="Operational Notifications"
      aria-live="polite"
      aria-relevant="additions"
    >
      @for (toast of toastService.toasts(); track toast.id) {
        <article
          class="toast-card"
          [class]="'variant-' + toast.variant"
          [attr.role]="toast.variant === 'error' ? 'alert' : 'status'"
        >
          <div class="toast-content">
            <strong class="toast-title">{{ toast.title }}</strong>
            <p class="toast-detail">{{ toast.detail }}</p>
          </div>
          <button
            type="button"
            class="toast-dismiss"
            (click)="toastService.dismiss(toast.id)"
            [attr.aria-label]="'Dismiss notification: ' + toast.title"
          >
            ✕
          </button>
        </article>
      }
    </section>
  `,
  styles: `
    .toast-viewport {
      position: fixed;
      inset-block-end: 1.15rem;
      inset-inline-end: 1.15rem;
      z-index: 70;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      inline-size: min(24rem, calc(100vw - 2.3rem));
      pointer-events: none;
    }

    .toast-card {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      padding-block: 0.75rem;
      padding-inline: 0.9rem;
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      border-inline-start-width: 4px;
      border-radius: 8px;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.48);
      animation: toastEnter 160ms ease-out;
    }

    .variant-error {
      border-inline-start-color: var(--accent-danger);
    }

    .variant-warning {
      border-inline-start-color: var(--accent-warning);
    }

    .variant-success {
      border-inline-start-color: var(--accent-success);
    }

    .variant-info {
      border-inline-start-color: var(--accent-primary);
    }

    .toast-content {
      min-inline-size: 0;
    }

    .toast-title {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-block-end: 0.2rem;
    }

    .toast-detail {
      margin: 0;
      font-size: 0.76rem;
      color: var(--text-secondary);
      line-height: 1.38;
      word-break: break-word;
    }

    .toast-dismiss {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding-block: 0.15rem;
      padding-inline: 0.3rem;
      border-radius: 4px;
      line-height: 1;
    }

    .toast-dismiss:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.06);
    }

    @keyframes toastEnter {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
})
export class ToastStackComponent {
  protected readonly toastService = inject(ToastService);
}
