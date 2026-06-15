// Implements ILLMRepository using the QVAC on-device SDK.
// The model runs entirely on the device — no internet required.
// Falls back to rule-based messages if the model is not loaded yet.

import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';
import { isQvacError } from '@/core/errors/obd.errors';
import type { ILLMRepository, LLMInterpretationRequest, LLMInterpretationResult } from '@/domain/repositories/i-llm.repository';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';

export class LLMRepositoryImpl implements ILLMRepository {
  async interpret(request: LLMInterpretationRequest): Promise<LLMInterpretationResult> {
    try {
      const result = await qvacSDK.interpret(
        request.parameters,
        request.troubleCodes,
        request.vehicleContext,
      );
      return { ...result, isAiGenerated: true };
    } catch (err) {
      if (isQvacError(err)) {
        return {
          text: this.buildFallbackMessage(request.parameters, request.troubleCodes),
          generatedAt: new Date(),
          isAiGenerated: false,
        };
      }
      throw err;
    }
  }

  async isAvailable(): Promise<boolean> {
    return qvacSDK.isLoaded();
  }

  // Rule-based fallback when the model is not loaded yet
  private buildFallbackMessage(
    parameters: ObdParameterSnapshot,
    troubleCodes: readonly TroubleCode[],
  ): string {
    if (troubleCodes.length > 0) {
      const critical = troubleCodes.filter((d) => d.severity === 'critical');
      if (critical.length > 0) {
        return `CRITICAL: ${critical.map((d) => d.code).join(', ')} detected. Stop vehicle and inspect immediately.`;
      }
      return `${troubleCodes.length} fault code(s) detected: ${troubleCodes.map((d) => d.code).join(', ')}. Schedule a diagnostic inspection.`;
    }

    const coolant = parameters['COOLANT_TEMP'];
    if (coolant?.alert?.severity === 'critical') {
      return 'Engine temperature is critically high. Stop the vehicle immediately and let it cool down.';
    }
    if (coolant?.alert?.severity === 'warning') {
      return 'Engine temperature is elevated. Monitor closely and reduce load.';
    }

    const voltage = parameters['VOLTAGE'];
    if (voltage?.alert?.severity === 'critical') {
      return 'Battery voltage is critically low. Check alternator and battery immediately.';
    }

    const rpm = parameters['RPM'];
    if (rpm?.alert) {
      return 'Engine RPM is very high. Ease off the throttle to protect the engine.';
    }

    return 'All monitored parameters are within normal range.';
  }
}
