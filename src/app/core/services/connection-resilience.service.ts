import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ConnectionState } from '../models/incident.model';

export interface BackoffConfig {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
  /**
   * Number of simulated failed reconnect handshakes before automatic recovery succeeds.
   * Defaults to 2 so operators observe exponential backoff progression (1s -> 2s -> 4s -> Connected).
   */
  readonly simulatedFailuresBeforeRecovery: number;
}

const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 16000,
  jitterRatio: 0.12,
  simulatedFailuresBeforeRecovery: 2,
};

@Injectable({ providedIn: 'root' })
export class ConnectionResilienceService {
  private readonly destroyRef = inject(DestroyRef);

  private config: BackoffConfig = DEFAULT_BACKOFF_CONFIG;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private targetRetryTimestamp = 0;

  private readonly connectionState = signal<ConnectionState>({
    phase: 'Connected',
    attempt: 0,
    nextRetryInMs: 0,
    currentBackoffDelayMs: 0,
    disconnectedAt: null,
    lastConnectedAt: Date.now(),
    reason: null,
  });

  readonly state = this.connectionState.asReadonly();
  readonly isConnected = computed(() => this.connectionState().phase === 'Connected');

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  configure(partial: Partial<BackoffConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Computes exponential backoff delay: min(maxDelayMs, baseDelayMs * 2^(attempt - 1)) + bounded jitter.
   */
  computeBackoffDelayMs(attempt: number, randomValue = Math.random()): number {
    const safeAttempt = Math.max(1, attempt);
    const exponential = Math.min(
      this.config.maxDelayMs,
      this.config.baseDelayMs * Math.pow(2, safeAttempt - 1),
    );
    const jitterWindow = exponential * this.config.jitterRatio;
    const jitterOffset = (randomValue * 2 - 1) * jitterWindow;
    return Math.max(100, Math.round(exponential + jitterOffset));
  }

  /**
   * Chaos action: drops active transport and initiates exponential backoff recovery,
   * or reconnects immediately if already offline/reconnecting.
   */
  toggleDisconnectSimulation(): void {
    if (this.connectionState().phase === 'Connected') {
      this.simulateDisconnect('Chaos Fault: Telemetry WebSocket transport dropped');
    } else {
      this.reconnectImmediately();
    }
  }

  simulateDisconnect(reason = 'Transport connection lost', autoRecover = true): void {
    this.clearTimers();
    const now = Date.now();

    if (!autoRecover) {
      this.connectionState.set({
        phase: 'Disconnected',
        attempt: 0,
        nextRetryInMs: 0,
        currentBackoffDelayMs: 0,
        disconnectedAt: now,
        lastConnectedAt: this.connectionState().lastConnectedAt,
        reason,
      });
      return;
    }

    this.scheduleReconnectAttempt(1, now, reason);
  }

  reconnectImmediately(): void {
    this.clearTimers();
    this.connectionState.set({
      phase: 'Connected',
      attempt: 0,
      nextRetryInMs: 0,
      currentBackoffDelayMs: 0,
      disconnectedAt: null,
      lastConnectedAt: Date.now(),
      reason: null,
    });
  }

  private scheduleReconnectAttempt(attempt: number, disconnectedAt: number, reason: string): void {
    this.clearTimers();
    const delayMs = this.computeBackoffDelayMs(attempt);
    this.targetRetryTimestamp = Date.now() + delayMs;

    this.connectionState.set({
      phase: 'Reconnecting',
      attempt,
      nextRetryInMs: delayMs,
      currentBackoffDelayMs: delayMs,
      disconnectedAt,
      lastConnectedAt: this.connectionState().lastConnectedAt,
      reason,
    });

    this.countdownTimer = setInterval(() => {
      const remaining = Math.max(0, this.targetRetryTimestamp - Date.now());
      this.connectionState.update((prev) =>
        prev.phase === 'Reconnecting' ? { ...prev, nextRetryInMs: remaining } : prev,
      );
    }, 100);

    this.retryTimeout = setTimeout(() => {
      if (attempt <= this.config.simulatedFailuresBeforeRecovery) {
        this.scheduleReconnectAttempt(
          attempt + 1,
          disconnectedAt,
          `Handshake timeout on attempt #${attempt}; escalating backoff`,
        );
      } else {
        this.reconnectImmediately();
      }
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }
}
