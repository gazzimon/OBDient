// Reads all stored DTCs from the ECU and returns them as domain entities.

import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface ReadTroubleCodesResult {
  codes: TroubleCode[];
  hasCritical: boolean;
  hasWarning: boolean;
  readAt: Date;
}

export class ReadTroubleCodesUseCase {
  constructor(private readonly obdRepo: IOBDRepository) {}

  async execute(): Promise<ReadTroubleCodesResult> {
    const codes = await this.obdRepo.readTroubleCodes();

    return {
      codes,
      hasCritical: codes.some((c) => c.severity === 'critical'),
      hasWarning: codes.some((c) => c.severity === 'warning'),
      readAt: new Date(),
    };
  }
}
