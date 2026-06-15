// ELM327 Bluetooth Classic datasource.
// Manages a single-command queue (ELM327 is strictly synchronous),
// adapter initialization sequence, and automatic reconnection.
//
// Queue resilience: after any command error, the queue resets to a resolved
// promise so subsequent commands always execute — no silent starvation.
//
// Circuit breaker: after CIRCUIT_OPEN_THRESHOLD consecutive failures the
// adapter pauses CIRCUIT_RESET_MS before trying again, preventing error storms.

import RNBluetoothClassic, {
  BluetoothDevice,
} from 'react-native-bluetooth-classic';
import {
  AdapterInitError,
  CommandTimeoutError,
  ConnectionFailedError,
  ConnectionLostError,
  MaxReconnectAttemptsError,
  NoDataError,
} from '@/core/errors/obd.errors';

const COMMAND_TIMEOUT_MS        = 2000;
const ATZ_TIMEOUT_MS            = 6000;
const RECONNECT_INTERVAL_MS     = 5000;
const MAX_RECONNECT_ATTEMPTS    = 3;
const CIRCUIT_OPEN_THRESHOLD    = 5;   // consecutive failures before pausing
const CIRCUIT_RESET_MS          = 10_000;
const HEALTH_CHECK_INTERVAL_MS  = 30_000;
const PROMPT_CHAR               = '>';

// AT initialization sequence for ELM327 HS Line
const INIT_SEQUENCE = ['ATZ', 'ATL0', 'ATE0', 'ATSP0'] as const;

export type AdapterEvent =
  | { type: 'queue-error';      command: string; error: string }
  | { type: 'circuit-open';     consecutiveFailures: number }
  | { type: 'circuit-reset' }
  | { type: 'reconnecting';     attempt: number; max: number }
  | { type: 'reconnect-failed' }
  | { type: 'health-check-ok' }
  | { type: 'health-check-fail'; error: string };

export type AdapterEventListener = (event: AdapterEvent) => void;

export class ELM327DataSource {
  private device: BluetoothDevice | null = null;
  private deviceAddress: string | null   = null;
  private connected                       = false;

  // Queue: always a resolved/pending promise — never rejected — so the next
  // command always gets to run. The per-command result is returned separately.
  private commandQueue: Promise<void> = Promise.resolve();

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpen         = false;

  // Health check
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Optional event listener for non-blocking UI feedback
  private eventListener: AdapterEventListener | null = null;

  setEventListener(listener: AdapterEventListener | null): void {
    this.eventListener = listener;
  }

  private emit(event: AdapterEvent): void {
    this.eventListener?.(event);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async connect(address: string): Promise<string> {
    this.deviceAddress   = address;
    this.reconnectAttempts = 0;
    this.consecutiveFailures = 0;
    this.circuitOpen     = false;

    try {
      this.device = await RNBluetoothClassic.connectToDevice(address);
      this.connected = true;
    } catch (err) {
      throw new ConnectionFailedError(address, err);
    }

    // Give the BT Classic socket time to stabilize before sending commands
    await this.delay(1000);
    await this.runInitSequence();

    // Detect OBD protocol via ATDP (describe protocol)
    const protocol = await this.sendRaw('ATDP');

    this.startHealthCheck();
    return protocol;
  }

  async disconnect(): Promise<void> {
    this.stopHealthCheck();
    this.clearReconnectTimer();
    this.connected = false;
    if (this.device) {
      try {
        await this.device.disconnect();
      } finally {
        this.device = null;
      }
    }
  }

  isConnected(): boolean {
    return this.connected && this.device !== null;
  }

  // Enqueues a command. The queue chain always resolves (never rejects) so
  // a failed command doesn't starve subsequent ones.
  async sendCommand(command: string): Promise<string> {
    // Circuit breaker: if too many consecutive failures, pause before queuing
    if (this.circuitOpen) {
      throw new ConnectionLostError(
        'Adapter circuit breaker open — too many consecutive failures',
      );
    }

    let resolveResult!: (value: string) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<string>((res, rej) => {
      resolveResult = res;
      rejectResult  = rej;
    });

    // Chain onto queue; queue promise itself never rejects
    this.commandQueue = this.commandQueue.then(async () => {
      try {
        const response = await this.sendRaw(command);
        this.consecutiveFailures = 0;
        resolveResult(response);
      } catch (err) {
        this.handleCommandError(command, err);
        rejectResult(err);
      }
    });

    return result;
  }

  // ─── Error handling & circuit breaker ───────────────────────────────────────

  private handleCommandError(command: string, err: unknown): void {
    this.consecutiveFailures++;
    this.emit({
      type: 'queue-error',
      command,
      error: err instanceof Error ? err.message : String(err),
    });

    if (err instanceof ConnectionLostError) {
      // Attempt reconnection in background — does not block the queue
      this.handleDisconnect().catch(() => undefined);
    }

    if (this.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.circuitOpen = true;
    this.emit({ type: 'circuit-open', consecutiveFailures: this.consecutiveFailures });
    setTimeout(() => {
      this.circuitOpen         = false;
      this.consecutiveFailures = 0;
      this.emit({ type: 'circuit-reset' });
    }, CIRCUIT_RESET_MS);
  }

  // ─── Health check ────────────────────────────────────────────────────────────

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(async () => {
      if (!this.isConnected() || this.circuitOpen) return;
      try {
        await this.sendRaw('ATI', COMMAND_TIMEOUT_MS);
        this.emit({ type: 'health-check-ok' });
      } catch (err) {
        this.emit({
          type: 'health-check-fail',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ─── Raw I/O ────────────────────────────────────────────────────────────────

  private async sendRaw(command: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    if (!this.device) throw new ConnectionLostError('No device connected');

    const fullCommand = `${command}\r`;

    try {
      await this.device.write(fullCommand);
    } catch (err) {
      throw new ConnectionLostError(`Write failed: ${String(err)}`, err);
    }

    return this.waitForResponse(command, timeoutMs);
  }

  // Reads data until '>' prompt or timeout
  private async waitForResponse(command: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buffer   = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        cleanup();
        reject(new CommandTimeoutError(command, timeoutMs));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        subscription?.remove();
      };

      const subscription = this.device?.onDataReceived((data) => {
        if (timedOut) return;

        buffer += data.data ?? '';

        if (buffer.includes(PROMPT_CHAR)) {
          cleanup();
          const response = buffer
            .replace(PROMPT_CHAR, '')
            .replace(command, '') // strip echo (ATE0 may not have taken effect yet)
            .replace(/\r\n|\r|\n/g, ' ')
            .trim();

          if (this.isNoDataResponse(response)) {
            reject(new NoDataError(command));
          } else {
            resolve(response);
          }
        }
      });

      if (!subscription) {
        cleanup();
        reject(new ConnectionLostError('Device disconnected before read'));
      }
    });
  }

  private isNoDataResponse(response: string): boolean {
    const upper = response.toUpperCase().replace(/\s/g, '');
    return (
      upper === 'NODATA' ||
      upper === 'ERROR' ||
      upper === 'UNABLETOCONNECT' ||
      upper === 'BUSINIT' ||
      upper === 'CANERROR'
    );
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  private async runInitSequence(): Promise<void> {
    for (const cmd of INIT_SEQUENCE) {
      try {
        // ATZ resets the adapter — cheap clones can take up to 5s to respond
        await this.sendRaw(cmd, cmd === 'ATZ' ? ATZ_TIMEOUT_MS : COMMAND_TIMEOUT_MS);
        if (cmd === 'ATZ') {
          await this.delay(500);
        }
      } catch (err) {
        // ATZ timeout is non-fatal — some clones don't respond but work fine
        if (err instanceof CommandTimeoutError && cmd === 'ATZ') {
          console.warn('[ELM327] ATZ timed out — continuing anyway');
          await this.delay(500);
          continue;
        }
        if (!(err instanceof NoDataError)) {
          throw new AdapterInitError(
            `Init command ${cmd} failed: ${String(err)}`,
            err,
          );
        }
        // NODATA during init is acceptable for some commands
      }
    }
  }

  // ─── Reconnection ────────────────────────────────────────────────────────────

  private async handleDisconnect(): Promise<void> {
    this.device    = null;
    this.connected = false;
    this.stopHealthCheck();

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit({ type: 'reconnect-failed' });
      throw new MaxReconnectAttemptsError(MAX_RECONNECT_ATTEMPTS);
    }

    this.reconnectAttempts++;
    this.emit({ type: 'reconnecting', attempt: this.reconnectAttempts, max: MAX_RECONNECT_ATTEMPTS });

    await this.delay(RECONNECT_INTERVAL_MS);

    if (!this.deviceAddress) throw new ConnectionLostError('No address to reconnect to');

    try {
      await this.connect(this.deviceAddress);
      this.reconnectAttempts = 0;
    } catch {
      // Will retry on next command failure
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton — one adapter connection per app session
export const elm327 = new ELM327DataSource();
