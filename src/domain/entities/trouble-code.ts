// A stored Diagnostic Trouble Code (DTC) from the vehicle's ECU.

import type { DtcSystem, DtcSeverity } from '@/core/utils/dtcParser';

export interface TroubleCode {
  readonly id: string;
  readonly code: string;          // e.g. "P0300"
  readonly system: DtcSystem;     // P | B | C | U
  readonly description: string;
  readonly severity: DtcSeverity;
  readonly detectedAt: Date;
  // AI-generated interpretation — null until queried
  readonly interpretation: string | null;
}

export function createTroubleCode(
  code: string,
  system: DtcSystem,
  description: string,
  severity: DtcSeverity,
): TroubleCode {
  return {
    id: `${code}-${Date.now()}`,
    code,
    system,
    description,
    severity,
    detectedAt: new Date(),
    interpretation: null,
  };
}
