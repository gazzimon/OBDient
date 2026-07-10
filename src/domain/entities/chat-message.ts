import type { GateResult } from '@/domain/services/diagnostic-gate';

export type ChatRole = 'user' | 'assistant';
export type ChatSource = 'carpsy' | 'claude';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: Date;
  readonly source?: ChatSource; // which agent produced this assistant message
  // Deterministic gate verdict for diagnosis messages (PLAN-002 v2 N2/UX1).
  // Hard violations render the message with an UNCONFIRMED badge.
  readonly gate?: GateResult;
}

export function createChatMessage(
  role: ChatRole,
  content: string,
  source?: ChatSource,
  gate?: GateResult,
): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    createdAt: new Date(),
    // Omit optional fields entirely when undefined (exactOptionalPropertyTypes).
    ...(source ? { source } : {}),
    ...(gate ? { gate } : {}),
  };
}
