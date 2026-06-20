// Contract for the local AI assistant (QVAC).
// If QVAC is unavailable, the use case falls back to hardcoded rule-based messages.

import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface LLMInterpretationRequest {
  readonly parameters: ObdParameterSnapshot;
  readonly troubleCodes: readonly TroubleCode[];
  readonly vehicleContext?: string;
}

// What knowledge a response drew on — so human feedback (👍/👎) can target it.
export interface RetrievalProvenance {
  // Canonical DTC whose SHIMI node confidence should move on feedback (null = none).
  readonly dtcId: string | null;
  // Query keys of Claude-origin entries used (for confirm/reject in claudeKnowledge).
  readonly claudeQueries: readonly string[];
  // Whether the response leaned on any unverified (Claude-origin) suggestion.
  readonly usedUnverified: boolean;
}

export interface LLMInterpretationResult {
  readonly text: string;
  readonly generatedAt: Date;
  // true if the response came from QVAC, false if it's a hardcoded fallback
  readonly isAiGenerated: boolean;
  // Present when the response went through the retrieval pipeline (chat flow).
  readonly retrieval?: RetrievalProvenance;
}

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LLMChatRequest {
  readonly history: readonly ChatTurn[];
  readonly systemContext: string;
  // Passed to the retrieval layer so SHIMI + SKOS can activate on active DTCs
  readonly troubleCodes: readonly TroubleCode[];
  readonly parameters: ObdParameterSnapshot;
}

export interface ILLMRepository {
  // Sends a diagnostic snapshot to QVAC and returns an interpretation.
  // Throws QvacUnavailableError if the server is not reachable.
  interpret(request: LLMInterpretationRequest): Promise<LLMInterpretationResult>;

  // Multi-turn chat — sends full history and returns the next assistant reply.
  chat(request: LLMChatRequest): Promise<LLMInterpretationResult>;

  // Checks if the QVAC server is reachable.
  isAvailable(): Promise<boolean>;
}
