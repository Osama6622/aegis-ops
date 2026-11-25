import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly variant: ToastVariant;
  readonly createdAt: number;
  readonly durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly itemsState = signal<readonly ToastMessage[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextId = 1;

  readonly toasts = this.itemsState.asReadonly();

  push(input: {
    readonly title: string;
    readonly detail: string;
    readonly variant: ToastVariant;
    readonly durationMs?: number;
  }): string {
    const id = `toast-${this.nextId++}`;
    const durationMs = input.durationMs ?? (input.variant === 'error' ? 6000 : 4000);
    const toast: ToastMessage = {
      id,
      title: input.title,
      detail: input.detail,
      variant: input.variant,
      createdAt: Date.now(),
      durationMs,
    };

    // Cap visible stack at 5 most recent notifications to avoid screen clutter during bursts.
    this.itemsState.update((current) => [toast, ...current].slice(0, 5));

    if (durationMs > 0) {
      const handle = setTimeout(() => this.dismiss(id), durationMs);
      this.timers.set(id, handle);
    }

    return id;
  }

  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.itemsState.update((current) => current.filter((item) => item.id !== id));
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.itemsState.set([]);
  }
}
