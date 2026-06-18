// Implements ILLMRepository using the QVAC on-device SDK.
// The model runs entirely on the device — no internet required.
// Falls back to rule-based messages if the model is not loaded yet.

import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';
import { qvacRag } from '@/data/datasources/qvac-rag.datasource';
import { hypercoreKnowledge } from '@/data/datasources/hypercore-knowledge.datasource';
import { retrievalContext } from '@/data/knowledge/obd-ontology';
import { isQvacError } from '@/core/errors/obd.errors';
import type { ILLMRepository, LLMInterpretationRequest, LLMInterpretationResult, LLMChatRequest } from '@/domain/repositories/i-llm.repository';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';

export class LLMRepositoryImpl implements ILLMRepository {
  async interpret(request: LLMInterpretationRequest): Promise<LLMInterpretationResult> {
    try {
      // Retrieve relevant repair knowledge on-device (RAG). Returns [] if the
      // RAG index isn't ready yet, so interpretation degrades gracefully.
      const query = this.buildRetrievalQuery(
        request.parameters,
        request.troubleCodes,
      );
      // SKOS-expanded query: include concept labels from the ontology hierarchy
      // so the embedder retrieves docs from related branches (e.g. P0300 misfire
      // also pulls in fuel system and emissions context).
      const primaryDtcId = request.troubleCodes[0]?.code;
      const ontologyExpansion = retrievalContext(primaryDtcId ?? '')
        .map((c) => c.label)
        .join('; ');
      const expandedQuery = ontologyExpansion ? `${query}; ${ontologyExpansion}` : query;

      const localSnippets = await qvacRag.search(expandedQuery, 5);

      // Enrich with distributed knowledge from Hypercore peers (opt-in, graceful degradation).
      const remoteSnippets = hypercoreKnowledge
        .getChunks(primaryDtcId)
        .slice(0, 3)
        .map((c) => c.content);

      const knowledge = [...localSnippets, ...remoteSnippets];

      const result = await qvacSDK.interpret(
        request.parameters,
        request.troubleCodes,
        request.vehicleContext,
        knowledge,
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

  async chat(request: LLMChatRequest): Promise<LLMInterpretationResult> {
    try {
      const result = await qvacSDK.chat(request.systemContext, request.history);
      return { ...result, isAiGenerated: true };
    } catch (err) {
      if (isQvacError(err)) {
        return {
          text: 'QVAC is not available. Load the model in Settings to enable the assistant.',
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

  // Builds a retrieval query from active fault codes and alerting parameters.
  // This text is embedded and matched against the on-device knowledge base.
  private buildRetrievalQuery(
    parameters: ObdParameterSnapshot,
    troubleCodes: readonly TroubleCode[],
  ): string {
    const parts: string[] = [];

    for (const dtc of troubleCodes) {
      parts.push(`${dtc.code} ${dtc.description}`);
    }

    for (const param of Object.values(parameters)) {
      if (param?.alert) {
        parts.push(`${param.name} ${param.alert.severity}`);
      }
    }

    return parts.join('; ') || 'general vehicle health check';
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
