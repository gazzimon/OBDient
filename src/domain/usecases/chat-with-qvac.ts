import type { ILLMRepository, LLMInterpretationResult, ChatTurn } from '@/domain/repositories/i-llm.repository';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { Vehicle } from '@/domain/entities/vehicle';

export interface ChatWithQVACInput {
  vehicle: Vehicle | null;
  mileage: number | null;
  troubleCodes: readonly TroubleCode[];
  // All turns so far (user + assistant), excluding the initial system context
  history: readonly ChatTurn[];
}

export class ChatWithQVACUseCase {
  constructor(private readonly llmRepo: ILLMRepository) {}

  async execute(input: ChatWithQVACInput): Promise<LLMInterpretationResult> {
    const systemContext = this.buildSystemContext(input);
    return this.llmRepo.chat({ systemContext, history: input.history });
  }

  private buildSystemContext(input: ChatWithQVACInput): string {
    const lines: string[] = [];

    if (input.vehicle) {
      const { make, model, year, vin, protocol } = input.vehicle;
      const yearStr = year != null ? ` ${year}` : '';
      lines.push(`Vehicle: ${make} ${model}${yearStr}`);
      if (vin) lines.push(`VIN: ${vin}`);
      lines.push(`OBD Protocol: ${protocol}`);
    }

    if (input.mileage != null) {
      lines.push(`Odometer: ${input.mileage.toLocaleString()} km`);
    }

    if (input.troubleCodes.length > 0) {
      lines.push(`\nActive DTCs (${input.troubleCodes.length}):`);
      for (const dtc of input.troubleCodes) {
        lines.push(`  ${dtc.code} [${dtc.severity}]: ${dtc.description}`);
      }
    } else {
      lines.push('\nNo active DTCs found.');
    }

    lines.push('\nYou are assisting a workshop technician. Answer concisely and ask follow-up questions when needed to narrow down the diagnosis.');
    return lines.join('\n');
  }
}
