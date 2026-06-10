// Contract for all OBD-II adapter operations.
// The data layer implements this; the domain layer depends only on this interface.

import type { Vehicle } from '@/domain/entities/vehicle';
import type { ObdParameter } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { PidId } from '@/core/constants/pids';

export interface IOBDRepository {
  // Initializes the ELM327 adapter (ATZ, ATL0, ATE0, ATSP0) and detects protocol.
  // Returns the connected vehicle with detected protocol.
  connect(deviceAddress: string): Promise<Vehicle>;

  // Gracefully closes the Bluetooth connection.
  disconnect(): Promise<void>;

  // Reads a single PID and returns the parsed parameter.
  readParameter(pidId: PidId): Promise<ObdParameter>;

  // Reads a batch of PIDs in sequence (ELM327 is synchronous).
  readParameters(pidIds: readonly PidId[]): Promise<ObdParameter[]>;

  // Sends mode 03 command and returns all stored DTCs.
  readTroubleCodes(): Promise<TroubleCode[]>;

  // Sends mode 04 command to clear all stored DTCs.
  clearTroubleCodes(): Promise<void>;

  // Returns true if the Bluetooth connection is currently open.
  isConnected(): boolean;
}
