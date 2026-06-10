// Contract for the local AI assistant (QVAC).
// If QVAC is unavailable, the use case falls back to hardcoded rule-based messages.

import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface LLMInterpretationRequest {
  readonly parameters: ObdParameterSnapshot;
  readonly troubleCodes: readonly TroubleCode[];
  readonly vehicleContext?: string;
}

export interface LLMInterpretationResult {
  readonly text: string;
  readonly generatedAt: Date;
  // true if the response came from QVAC, false if it's a hardcoded fallback
  readonly isAiGenerated: boolean;
}

export interface ILLMRepository {
  // Sends a diagnostic snapshot to QVAC and returns an interpretation.
  // Throws QvacUnavailableError if the server is not reachable.
  interpret(request: LLMInterpretationRequest): Promise<LLMInterpretationResult>;

  // Checks if the QVAC server is reachable.
  isAvailable(): Promise<boolean>;
}
