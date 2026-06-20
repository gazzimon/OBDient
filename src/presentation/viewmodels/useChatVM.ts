// Manages multi-turn QVAC chat for an active diagnostic session.
// The first message is auto-sent by the system with vehicle + DTC context.

import { useState, useCallback } from 'react';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { container } from '@/data/container';
import { createChatMessage } from '@/domain/entities/chat-message';
import type { ChatSource } from '@/domain/entities/chat-message';
import type { ChatTurn } from '@/domain/repositories/i-llm.repository';

export function useChatVM() {
  const [isResponding, setIsResponding] = useState(false);
  const [chatError, setChatError]       = useState<string | null>(null);

  const vehicle       = useOBDStore((s) => s.vehicle);
  const parameters    = useOBDStore((s) => s.parameters);
  const activeSession = useSessionStore((s) => s.activeSession);
  const addChatMessage = useSessionStore((s) => s.addChatMessage);

  const messages = activeSession?.messages ?? [];
  const codes    = activeSession?.troubleCodes ?? [];
  const mileage  = activeSession?.mileage ?? null;

  const sendMessage = useCallback(async (userText: string) => {
    if (isResponding) return;
    setChatError(null);

    const userMsg = createChatMessage('user', userText.trim());
    addChatMessage(userMsg);
    setIsResponding(true);

    try {
      // Build history from stored messages + the new user message
      const history: ChatTurn[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMsg.content },
      ];

      const result = await container.multiAgentChat.execute({
        vehicle,
        mileage,
        troubleCodes: codes,
        parameters,
        history,
      });

      const source: ChatSource = 'source' in result ? result.source : 'carpsy';
      addChatMessage(createChatMessage('assistant', result.text, source));
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Chat failed');
    } finally {
      setIsResponding(false);
    }
  }, [isResponding, messages, vehicle, mileage, codes, parameters, addChatMessage]);

  // Auto-sends the initial QVAC assessment after DTCs are read
  const sendInitialAssessment = useCallback(async (prompt: string) => {
    if (isResponding) return;
    setChatError(null);
    setIsResponding(true);
    try {
      const result = await container.multiAgentChat.execute({
        vehicle,
        mileage,
        troubleCodes: codes,
        parameters,
        history: [{ role: 'user', content: prompt }],
      });
      const source: ChatSource = 'source' in result ? result.source : 'carpsy';
      addChatMessage(createChatMessage('assistant', result.text, source));
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Initial assessment failed');
    } finally {
      setIsResponding(false);
    }
  }, [isResponding, vehicle, mileage, codes, parameters, addChatMessage]);

  return {
    messages,
    isResponding,
    chatError,
    sendMessage,
    sendInitialAssessment,
  } as const;
}
