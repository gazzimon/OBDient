// Implements IOBDRepository using the ELM327 datasource.

import { elm327 } from '@/data/datasources/elm327.datasource';
import { mapRawResponseToObdParameter } from '@/data/mappers/pid.mapper';
import { mapRawResponseToTroubleCodes } from '@/data/mappers/dtc.mapper';
import { createUnknownVehicle, type OBDProtocol } from '@/domain/entities/vehicle';
import type { Vehicle } from '@/domain/entities/vehicle';
import type { ObdParameter } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';
import type { PidId } from '@/core/constants/pids';

// Maps ELM327 ATDP response strings to typed OBDProtocol
function parseProtocol(response: string): OBDProtocol {
  const upper = response.toUpperCase();
  if (upper.includes('ISO 15765') && upper.includes('500')) {
    return upper.includes('29') ? 'ISO_15765_4_CAN_29BIT_500K' : 'ISO_15765_4_CAN_11BIT_500K';
  }
  if (upper.includes('ISO 15765') && upper.includes('250')) {
    return upper.includes('29') ? 'ISO_15765_4_CAN_29BIT_250K' : 'ISO_15765_4_CAN_11BIT_250K';
  }
  if (upper.includes('ISO 14230') && upper.includes('FAST')) return 'ISO_14230_4_KWP_FAST';
  if (upper.includes('ISO 14230')) return 'ISO_14230_4_KWP';
  if (upper.includes('ISO 9141')) return 'ISO_9141_2';
  if (upper.includes('J1850') && upper.includes('PWM')) return 'SAE_J1850_PWM';
  if (upper.includes('J1850')) return 'SAE_J1850_VPW';
  if (upper.includes('AUTO')) return 'AUTO';
  return 'UNKNOWN';
}

export class OBDRepositoryImpl implements IOBDRepository {
  async connect(deviceAddress: string): Promise<Vehicle> {
    const protocolString = await elm327.connect(deviceAddress);
    const protocol = parseProtocol(protocolString);
    return createUnknownVehicle(deviceAddress, protocol);
  }

  async disconnect(): Promise<void> {
    await elm327.disconnect();
  }

  async readParameter(pidId: PidId): Promise<ObdParameter> {
    const raw = await elm327.sendCommand(pidId === 'VOLTAGE' ? 'ATRV' : pidId);
    return mapRawResponseToObdParameter(pidId, raw);
  }

  async readParameters(pidIds: readonly PidId[]): Promise<ObdParameter[]> {
    const results: ObdParameter[] = [];
    for (const pid of pidIds) {
      try {
        const param = await this.readParameter(pid);
        results.push(param);
      } catch {
        // Skip failed PIDs — partial data is better than none
      }
    }
    return results;
  }

  async readTroubleCodes(): Promise<TroubleCode[]> {
    const raw = await elm327.sendCommand('03');
    return mapRawResponseToTroubleCodes(raw);
  }

  async clearTroubleCodes(): Promise<void> {
    await elm327.sendCommand('04');
  }

  isConnected(): boolean {
    return elm327.isConnected();
  }
}
