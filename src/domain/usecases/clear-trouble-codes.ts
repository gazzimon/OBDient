// Sends the mode-04 command to clear all stored DTCs from the ECU.
// Requires explicit user confirmation before executing — this is irreversible.

import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';

export class ClearTroubleCodesUseCase {
  constructor(private readonly obdRepo: IOBDRepository) {}

  async execute(confirmedByUser: boolean): Promise<void> {
    if (!confirmedByUser) {
      throw new Error('ClearTroubleCodes requires explicit user confirmation');
    }
    await this.obdRepo.clearTroubleCodes();
  }
}
