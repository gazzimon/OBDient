// Junior chat pipeline (CARpsy on-device).
//
// Token policy: every free-form chat turn — diagnostic or general — is
// answered locally. Claude is never called from here; the ONLY Claude entry
// points are the senior handoff/conversation in DiagnosticIntakeSessionUseCase,
// and only after the user explicitly opts in ("consult the senior advisor").
// The previous general→Claude routing and the per-turn background quality
// eval were removed: they spent tokens on greetings and invisible audits.

import type { ChatWithQVACUseCase, ChatWithQVACInput } from './chat-with-qvac';
import type { LLMInterpretationResult } from '@/domain/repositories/i-llm.repository';
import type { ChatSource } from '@/domain/entities/chat-message';

export interface MultiAgentChatResult extends LLMInterpretationResult {
  readonly source: ChatSource;
  // Set by the intake session when a completed case is waiting for the user
  // to opt into the senior (Claude) review. Drives the offer button in the UI.
  readonly seniorOffer?: boolean;
  // Set only on diagnosis answers (QVAC preliminary + the senior's first reply).
  // Drives the single 👍/👎 in the chat — questions, greetings and follow-up
  // chatter carry no thumb (the case-level outcome lives in Reports instead).
  readonly rateable?: boolean;
}

export class MultiAgentChatUseCase {
  constructor(private readonly carpsy: ChatWithQVACUseCase) {}

  async execute(input: ChatWithQVACInput): Promise<MultiAgentChatResult> {
    const result = await this.carpsy.execute(input);
    return { ...result, source: 'carpsy' };
  }
}
