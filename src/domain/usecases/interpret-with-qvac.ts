// Sends a diagnostic snapshot to QVAC and returns an AI interpretation.
// Gracefully falls back to rule-based messages when QVAC is offline.

import type { ILLMRepository, LLMInterpretationResult } from '@/domain/repositories/i-llm.repository';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface InterpretWithQVACInput {
  parameters: ObdParameterSnapshot;
  troubleCodes: readonly TroubleCode[];
  vehicleContext?: string;
}

export class InterpretWithQVACUseCase {
  constructor(private readonly llmRepo: ILLMRepository) {}

  async execute(input: InterpretWithQVACInput): Promise<LLMInterpretationResult> {
    const request = {
      parameters: input.parameters,
      troubleCodes: input.troubleCodes,
      ...(input.vehicleContext !== undefined && { vehicleContext: input.vehicleContext }),
    };
    return this.llmRepo.interpret(request);
  }
}
