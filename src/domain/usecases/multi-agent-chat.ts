// Multi-agent chat orchestrator.
//
// Routes each message to the right agent:
//   - CARpsy (on-device) → diagnostic queries, DTCs, sensor faults
//   - Claude API (cloud)  → general automotive questions
//
// Falls back to CARpsy if Claude is not configured or the network fails.

import { classifyQuery } from './query-router';
import type { ChatWithQVACUseCase, ChatWithQVACInput } from './chat-with-qvac';
import type { ClaudeAPIDataSource } from '@/data/datasources/claude-api.datasource';
import type { ClaudeKnowledgeDataSource } from '@/data/datasources/claude-knowledge.datasource';
import type { LLMInterpretationResult } from '@/domain/repositories/i-llm.repository';
import type { ChatSource } from '@/domain/entities/chat-message';

export interface MultiAgentChatResult extends LLMInterpretationResult {
  readonly source: ChatSource;
}

export class MultiAgentChatUseCase {
  constructor(
    private readonly carpsy: ChatWithQVACUseCase,
    private readonly claude: ClaudeAPIDataSource,
    private readonly claudeKnowledge: ClaudeKnowledgeDataSource,
  ) {}

  async execute(input: ChatWithQVACInput): Promise<MultiAgentChatResult> {
    const lastUserTurn = [...input.history].reverse().find((t) => t.role === 'user');
    const userText = lastUserTurn?.content ?? '';
    const queryType = classifyQuery(userText, input.troubleCodes.length > 0);

    // Always use CARpsy when diagnostic, or when Claude isn't configured
    if (queryType === 'diagnostic' || !this.claude.isConfigured()) {
      const result = await this.carpsy.execute(input);

      // Fire quality evaluation in background (non-blocking) when Claude is available
      if (this.claude.isConfigured() && userText) {
        const vehicleCtx = this.buildVehicleCtx(input);
        this.runQualityEval(vehicleCtx, userText, result.text).catch(() => {});
      }

      return { ...result, source: 'carpsy' };
    }

    // General question → Claude API
    const vehicleCtx = this.buildVehicleCtx(input);
    try {
      const text = await this.claude.answerGeneral(vehicleCtx, userText);

      // Persist Claude's answer in SHIMI knowledge for offline reuse
      await this.claudeKnowledge.store(userText, text);

      return { text, generatedAt: new Date(), isAiGenerated: true, source: 'claude' };
    } catch (err) {
      console.warn('[MultiAgent] Claude failed, falling back to CARpsy:', err);
      const result = await this.carpsy.execute(input);
      return { ...result, source: 'carpsy' };
    }
  }

  private buildVehicleCtx(input: ChatWithQVACInput): string {
    if (!input.vehicle) return 'Unknown vehicle';
    const { make, model, year } = input.vehicle;
    return [make, model, year != null ? String(year) : ''].filter(Boolean).join(' ');
  }

  private async runQualityEval(
    vehicleCtx: string,
    question: string,
    carpsynAnswer: string,
  ): Promise<void> {
    const evaluation = await this.claude.evaluateResponse(vehicleCtx, question, carpsynAnswer);
    if (!evaluation.isAcceptable && evaluation.correction) {
      await this.claudeKnowledge.store(question, evaluation.correction);
      console.log(`[QualityEval] Score ${evaluation.score}/5 — correction stored in SHIMI`);
    } else {
      console.log(`[QualityEval] Score ${evaluation.score}/5 — response acceptable`);
    }
  }
}
