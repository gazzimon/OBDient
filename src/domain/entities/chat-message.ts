export type ChatRole = 'user' | 'assistant';
export type ChatSource = 'carpsy' | 'claude';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: Date;
  readonly source?: ChatSource; // which agent produced this assistant message
}

export function createChatMessage(
  role: ChatRole,
  content: string,
  source?: ChatSource,
): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    createdAt: new Date(),
    // Omit `source` entirely when undefined (exactOptionalPropertyTypes).
    ...(source ? { source } : {}),
  };
}
