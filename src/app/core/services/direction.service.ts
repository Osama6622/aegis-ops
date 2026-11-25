import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type LayoutDirection = 'ltr' | 'rtl';

@Injectable({ providedIn: 'root' })
export class DirectionService {
  private readonly document = inject(DOCUMENT);
  private readonly dirState = signal<LayoutDirection>('ltr');

  readonly dir = this.dirState.asReadonly();

  constructor() {
    effect(() => {
      const current = this.dirState();
      this.document.documentElement.setAttribute('dir', current);
    });
  }

  toggleDirection(): void {
    this.dirState.update((current) => (current === 'ltr' ? 'rtl' : 'ltr'));
  }

  setDirection(direction: LayoutDirection): void {
    this.dirState.set(direction);
  }
}
