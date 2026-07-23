import type { ILLMRepository, LLMInterpretationResult, ChatTurn } from '@/domain/repositories/i-llm.repository';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { Vehicle } from '@/domain/entities/vehicle';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';

export interface ChatWithQVACInput {
  vehicle: Vehicle | null;
  mileage: number | null;
  troubleCodes: readonly TroubleCode[];
  parameters: ObdParameterSnapshot;
  history: readonly ChatTurn[];
  // User's chosen assistant source (Beta V2 header selector). 'cloud' closes the
  // intake with the senior offer instead of running the slow on-device diagnosis;
  // 'offline' (or undefined) keeps the local-first behaviour.
  seniorSource?: 'offline' | 'cloud';
  // User-selected app language (Beta V2 Settings selector). When set, it pins the
  // deterministic intake language instead of auto-detecting from the owner's text.
  language?: 'pt' | 'es' | 'en';
}

export class ChatWithQVACUseCase {
  constructor(private readonly llmRepo: ILLMRepository) {}

  async execute(input: ChatWithQVACInput): Promise<LLMInterpretationResult> {
    const systemContext = this.buildSystemContext(input);
    return this.llmRepo.chat({
      systemContext,
      history: input.history,
      troubleCodes: input.troubleCodes,
      parameters: input.parameters,
    });
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

    const paramEntries = Object.values(input.parameters).filter(Boolean);
    if (paramEntries.length > 0) {
      lines.push('\nLive OBD-II sensor readings:');
      for (const param of paramEntries) {
        if (param) {
          const alert = param.alert ? ` ⚠️ ${param.alert.severity.toUpperCase()}: ${param.alert.message}` : '';
          lines.push(`  ${param.name}: ${param.value.toFixed(1)} ${param.unit}${alert}`);
        }
      }
    }

    if (input.troubleCodes.length > 0) {
      lines.push(`\nActive DTCs (${input.troubleCodes.length}):`);
      for (const dtc of input.troubleCodes) {
        lines.push(`  ${dtc.code} [${dtc.severity}]: ${dtc.description}`);
      }
    } else {
      lines.push('\nNo active DTCs found.');
    }

    lines.push('\nYou are assisting a vehicle owner or technician. Answer concisely in the same language the user writes in.');
    return lines.join('\n');
  }
}
