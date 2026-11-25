import { Injectable, signal } from '@angular/core';
import { Observable, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { OptimisticActionKind } from '../models/incident.model';

export interface MutationSuccessResponse {
  readonly incidentId: string;
  readonly action: OptimisticActionKind;
  readonly assignee: string | null;
  readonly processedAt: number;
  readonly latencyMs: number;
}

export interface ApiSimulatorConfig {
  readonly minLatencyMs: number;
  readonly maxLatencyMs: number;
  readonly failureRate: number;
}

const DEFAULT_API_CONFIG: ApiSimulatorConfig = {
  minLatencyMs: 300,
  maxLatencyMs: 800,
  failureRate: 0.15,
};

@Injectable({ providedIn: 'root' })
export class IncidentApiSimulatorService {
  private config: ApiSimulatorConfig = DEFAULT_API_CONFIG;

  /**
   * Optional chaos switch allowing evaluators to deterministically force the next mutation
   * to fail on demand, in addition to the organic ~15% failure rate.
   */
  readonly forceNextFailure = signal<boolean>(false);

  configure(partial: Partial<ApiSimulatorConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  executeIncidentAction(params: {
    readonly incidentId: string;
    readonly action: OptimisticActionKind;
    readonly assignee?: string | null;
    readonly randomLatencySeed?: number;
    readonly randomFailureSeed?: number;
  }): Observable<MutationSuccessResponse> {
    const latencyRoll = params.randomLatencySeed ?? Math.random();
    const failureRoll = params.randomFailureSeed ?? Math.random();

    const span = Math.max(0, this.config.maxLatencyMs - this.config.minLatencyMs);
    const latencyMs = Math.round(this.config.minLatencyMs + latencyRoll * span);

    const shouldForceFail = this.forceNextFailure();
    if (shouldForceFail) {
      this.forceNextFailure.set(false);
    }

    const willFail = shouldForceFail || failureRoll < this.config.failureRate;

    return timer(latencyMs).pipe(
      map(() => {
        if (willFail) {
          throw new Error(
            `503 Upstream Write Conflict: Failed to ${params.action} ${params.incidentId} after ${latencyMs}ms`,
          );
        }

        return {
          incidentId: params.incidentId,
          action: params.action,
          assignee: params.assignee ?? null,
          processedAt: Date.now(),
          latencyMs,
        };
      }),
    );
  }
}
