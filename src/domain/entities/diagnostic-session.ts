// A complete diagnostic session: all readings and DTCs captured at one point in time.

import type { ObdParameterSnapshot } from './obd-parameter';
import type { TroubleCode } from './trouble-code';

export type SessionStatus = 'active' | 'completed' | 'interrupted';

export interface DiagnosticSession {
  readonly id: string;
  readonly vehicleId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly status: SessionStatus;
  readonly parameters: ObdParameterSnapshot;
  readonly troubleCodes: readonly TroubleCode[];
  // Full AI-generated interpretation of the session — null if not yet requested
  readonly interpretation: string | null;
}

export function createSession(vehicleId: string): DiagnosticSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    vehicleId,
    startedAt: new Date(),
    endedAt: null,
    status: 'active',
    parameters: {},
    troubleCodes: [],
    interpretation: null,
  };
}
