export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: Date;
}

export function createChatMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    createdAt: new Date(),
  };
}
