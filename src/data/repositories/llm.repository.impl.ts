// Implements ILLMRepository using the QVAC on-device SDK.
// The model runs entirely on the device — no internet required.
// Falls back to rule-based messages if the model is not loaded yet.

import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';
import { shimiDataSource } from '@/data/datasources/shimi.datasource';
import { hypercoreKnowledge } from '@/data/datasources/hypercore-knowledge.datasource';
import { evaluatePatterns } from '@/data/datasources/pattern-evaluator';
import { retrievalContext } from '@/data/knowledge/obd-ontology';
import { isQvacError, QvacUnavailableError } from '@/core/errors/obd.errors';
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
      // SKOS-expanded query for the embedding layer.
      const primaryDtcId = request.troubleCodes[0]?.code;
      const ontologyExpansion = retrievalContext(primaryDtcId ?? '')
        .map((c) => c.label)
        .join('; ');
      const expandedQuery = ontologyExpansion ? `${query}; ${ontologyExpansion}` : query;

      // SHIMI retrieval: hierarchical (confidence-ranked) + QVAC RAG hybrid.
      const localSnippets = await shimiDataSource.search(primaryDtcId, expandedQuery, 6);

      // Layer 1 — distributed atomic facts from Hypercore peers.
      const remoteSnippets = hypercoreKnowledge
        .getChunks(primaryDtcId)
        .slice(0, 3)
        .map((c) => c.content);

      // Layer 2 — conditional patterns evaluated against the live OBD snapshot.
      const patternMatches = evaluatePatterns(
        hypercoreKnowledge.getPatterns(),
        request.troubleCodes,
        request.parameters,
        request.vehicleContext,
      ).map((m) => `Pattern (confidence ${m.pattern.confidence.toFixed(2)}): ${m.conclusion}`);

      const knowledge = [...localSnippets, ...remoteSnippets, ...patternMatches];

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
      const primaryDtcId = request.troubleCodes[0]?.code;
      const lastUserTurn = [...request.history].reverse().find((t) => t.role === 'user');
      const userQuery = lastUserTurn?.content ?? '';

      // Build the retrieval query (SKOS-expanded when a DTC is present).
      const diagnosticQuery = this.buildRetrievalQuery(request.parameters, request.troubleCodes);
      const ontologyExpansion = primaryDtcId
        ? retrievalContext(primaryDtcId).map((c) => c.label).join('; ')
        : '';
      const expandedQuery = [userQuery, diagnosticQuery, ontologyExpansion]
        .filter(Boolean)
        .join('; ');

      // Provenance-aware retrieval: curated (trusted) vs Claude-origin (unverified).
      const retrieval = await shimiDataSource.searchWithProvenance(primaryDtcId, expandedQuery, 3);

      // Patterns are curated/rule-based → count as verified. Only with DTCs present.
      const patterns = primaryDtcId
        ? evaluatePatterns(
            hypercoreKnowledge.getPatterns(),
            request.troubleCodes,
            request.parameters,
          ).slice(0, 1).map((m) => `Pattern: ${m.conclusion}`)
        : [];

      const verified = [...retrieval.verified, ...patterns];
      const unverified = retrieval.unverified;

      // Two clearly-labelled sections: the model must trust verified knowledge,
      // and treat unverified Claude suggestions as hypotheses (not ground truth).
      const cap = (s: string) => s.slice(0, 300);
      const sections: string[] = [];
      if (verified.length > 0) {
        sections.push(
          `Verified diagnostic knowledge (trusted — base your diagnosis on this):\n` +
            verified.map((s, i) => `[V${i + 1}] ${cap(s)}`).join('\n'),
        );
      }
      if (unverified.length > 0) {
        sections.push(
          `Unverified suggestions (AI-generated, NOT yet confirmed — treat as hypotheses, ` +
            `mention uncertainty, do not state as fact):\n` +
            unverified.map((u, i) => `[U${i + 1}] ${cap(u.content)}`).join('\n'),
        );
      }
      const knowledgeBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';

      const enrichedContext = request.systemContext + knowledgeBlock;
      const result = await qvacSDK.chat(enrichedContext, request.history);
      return {
        ...result,
        isAiGenerated: true,
        retrieval: {
          dtcId: primaryDtcId ?? null,
          claudeQueries: unverified.map((u) => u.query),
          usedUnverified: unverified.length > 0,
        },
      };
    } catch (err) {
      if (isQvacError(err)) {
        console.error('[QVAC] chat() failed:', err);
        // The model being unloaded and the prompt overflowing the context window
        // are different failures — telling the user to "load the model" when it's
        // already loaded just sends them in circles. Pick the message that matches.
        const isContextOverflow =
          err instanceof Error && /context.?overflow|context window/i.test(err.message);
        const text = err instanceof QvacUnavailableError
          ? 'QVAC is not available. Load the model in Settings to enable the assistant.'
          : isContextOverflow
            ? 'That question carried too much data for the on-device model. Try a shorter question, or tap ✕ to start a new conversation.'
            : 'The on-device model could not answer that. Please try again.';
        return {
          text,
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
