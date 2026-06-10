// Polls a set of PIDs at a configurable interval and delivers each reading
// to a callback. Runs until stop() is called or the connection drops.
// Uses a sequential queue (one PID at a time) matching ELM327 constraints.

import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';
import type { ObdParameter } from '@/domain/entities/obd-parameter';
import type { PidId } from '@/core/constants/pids';
import { DASHBOARD_PIDS } from '@/core/constants/pids';
import { ConnectionLostError, MaxReconnectAttemptsError } from '@/core/errors/obd.errors';

export interface ReadRealTimeParametersInput {
  pids?: readonly PidId[];
  // Milliseconds between full polling cycles (default 500ms)
  intervalMs?: number;
  onParameter: (param: ObdParameter) => void;
  onError?: (error: unknown) => void;
  onConnectionLost?: () => void;
}

export class ReadRealTimeParametersUseCase {
  private running = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly obdRepo: IOBDRepository) {}

  start(input: ReadRealTimeParametersInput): void {
    if (this.running) return;
    this.running = true;

    const pids = input.pids ?? DASHBOARD_PIDS;
    const intervalMs = input.intervalMs ?? 500;

    const poll = async () => {
      if (!this.running) return;

      for (const pid of pids) {
        if (!this.running) break;

        try {
          const param = await this.obdRepo.readParameter(pid);
          if (this.running) input.onParameter(param);
        } catch (err) {
          if (
            err instanceof ConnectionLostError ||
            err instanceof MaxReconnectAttemptsError
          ) {
            this.running = false;
            input.onConnectionLost?.();
            return;
          }
          // Non-fatal: skip this PID this cycle
          input.onError?.(err);
        }
      }

      if (this.running) {
        this.timeoutHandle = setTimeout(poll, intervalMs);
      }
    };

    void poll();
  }

  stop(): void {
    this.running = false;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
