// ELM327 Bluetooth Classic datasource.
// Manages a single-command queue (ELM327 is strictly synchronous),
// adapter initialization sequence, and automatic reconnection.

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

const COMMAND_TIMEOUT_MS = 2000;
const RECONNECT_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 3;
const PROMPT_CHAR = '>';

// AT initialization sequence for ELM327 HS Line
const INIT_SEQUENCE = ['ATZ', 'ATL0', 'ATE0', 'ATSP0'] as const;

export class ELM327DataSource {
  private device: BluetoothDevice | null = null;
  private deviceAddress: string | null = null;
  private connected = false;
  // Serializes all commands — only one can be in-flight at a time
  private commandQueue: Promise<string> = Promise.resolve('');
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(address: string): Promise<string> {
    this.deviceAddress = address;
    this.reconnectAttempts = 0;

    try {
      this.device = await RNBluetoothClassic.connectToDevice(address);
      this.connected = true;
    } catch (err) {
      throw new ConnectionFailedError(address, err);
    }

    await this.runInitSequence();

    // Detect OBD protocol via ATDP (describe protocol)
    const protocol = await this.sendRaw('ATDP');
    return protocol;
  }

  async disconnect(): Promise<void> {
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

  // Enqueues a command — the queue ensures no two commands run concurrently
  async sendCommand(command: string): Promise<string> {
    this.commandQueue = this.commandQueue.then(() =>
      this.sendRaw(command).catch(async (err) => {
        if (err instanceof ConnectionLostError) {
          await this.handleDisconnect();
        }
        throw err;
      }),
    );
    return this.commandQueue;
  }

  // Sends a raw AT/OBD command and waits for the '>' prompt
  private async sendRaw(command: string): Promise<string> {
    if (!this.device) throw new ConnectionLostError('No device connected');

    const fullCommand = `${command}\r`;

    try {
      await this.device.write(fullCommand);
    } catch (err) {
      throw new ConnectionLostError(`Write failed: ${String(err)}`, err);
    }

    return this.waitForResponse(command);
  }

  // Reads data until '>' prompt or timeout
  private async waitForResponse(command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buffer = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        cleanup();
        reject(new CommandTimeoutError(command, COMMAND_TIMEOUT_MS));
      }, COMMAND_TIMEOUT_MS);

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

  // Runs the AT initialization sequence after connecting
  private async runInitSequence(): Promise<void> {
    for (const cmd of INIT_SEQUENCE) {
      try {
        await this.sendRaw(cmd);
        // Small delay after ATZ (adapter resets)
        if (cmd === 'ATZ') {
          await this.delay(500);
        }
      } catch (err) {
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

  // Called when a command detects the connection was lost
  private async handleDisconnect(): Promise<void> {
    this.device = null;
    this.connected = false;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      throw new MaxReconnectAttemptsError(MAX_RECONNECT_ATTEMPTS);
    }

    this.reconnectAttempts++;

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
