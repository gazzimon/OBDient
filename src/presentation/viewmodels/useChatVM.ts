// Manages multi-turn QVAC chat for an active diagnostic session.
// The first message is auto-sent by the system with vehicle + DTC context.

import { useState, useCallback } from 'react';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { container } from '@/data/container';
import { shimiDataSource } from '@/data/datasources/shimi.datasource';
import { claudeKnowledge } from '@/data/datasources/claude-knowledge.datasource';
import { createChatMessage } from '@/domain/entities/chat-message';
import type { ChatSource } from '@/domain/entities/chat-message';
import type { ChatTurn, RetrievalProvenance } from '@/domain/repositories/i-llm.repository';

export type Rating = 'up' | 'down';

// Per-message feedback state: what the response drew on + the user's rating.
export interface MessageFeedback {
  readonly provenance: RetrievalProvenance;
  readonly rating: Rating | null;
}

export function useChatVM() {
  const [isResponding, setIsResponding] = useState(false);
  const [chatError, setChatError]       = useState<string | null>(null);
  // messageId → feedback. Ephemeral (session-scoped); confidence changes persist.
  const [feedback, setFeedback] = useState<Record<string, MessageFeedback>>({});

  const vehicle       = useOBDStore((s) => s.vehicle);
  const parameters    = useOBDStore((s) => s.parameters);
  const activeSession = useSessionStore((s) => s.activeSession);
  const addChatMessage = useSessionStore((s) => s.addChatMessage);
  const pendingMileage = useSessionStore((s) => s.pendingMileage);

  const messages = activeSession?.messages ?? [];
  const codes    = activeSession?.troubleCodes ?? [];
  const mileage  = activeSession?.mileage ?? pendingMileage;

  // Always-open chat (ADR-0009): the first message creates an ad-hoc session,
  // adopted later by the real vehicle id when the adapter connects.
  const ensureSession = useCallback((): string => {
    const store = useSessionStore.getState();
    if (store.activeSession == null) {
      store.startSession(vehicle?.id ?? 'unconnected');
    }
    return useSessionStore.getState().activeSession?.id ?? 'adhoc';
  }, [vehicle?.id]);

  const sendMessage = useCallback(async (userText: string) => {
    if (isResponding) return;
    setChatError(null);
    const sessionId = ensureSession();

    const userMsg = createChatMessage('user', userText.trim());
    addChatMessage(userMsg);
    setIsResponding(true);

    try {
      // Build history from stored messages + the new user message
      const history: ChatTurn[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMsg.content },
      ];

      // ADR-0009 session pipeline: intake → brief → senior handoff
      const result = await container.diagnosticSession.execute(sessionId, {
        vehicle,
        mileage,
        troubleCodes: codes,
        parameters,
        history,
      });

      const source: ChatSource = 'source' in result ? result.source : 'carpsy';
      const assistantMsg = createChatMessage('assistant', result.text, source);
      addChatMessage(assistantMsg);
      if (result.retrieval) {
        const prov = result.retrieval;
        setFeedback((f) => ({ ...f, [assistantMsg.id]: { provenance: prov, rating: null } }));
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Chat failed');
    } finally {
      setIsResponding(false);
    }
  }, [isResponding, messages, vehicle, mileage, codes, parameters, addChatMessage, ensureSession]);

  // Auto-sends the initial QVAC assessment after DTCs are read
  const sendInitialAssessment = useCallback(async (prompt: string) => {
    if (isResponding) return;
    setChatError(null);
    const sessionId = ensureSession();
    setIsResponding(true);
    try {
      const result = await container.diagnosticSession.execute(sessionId, {
        vehicle,
        mileage,
        troubleCodes: codes,
        parameters,
        history: [{ role: 'user', content: prompt }],
      });
      const source: ChatSource = 'source' in result ? result.source : 'carpsy';
      const assistantMsg = createChatMessage('assistant', result.text, source);
      addChatMessage(assistantMsg);
      if (result.retrieval) {
        const prov = result.retrieval;
        setFeedback((f) => ({ ...f, [assistantMsg.id]: { provenance: prov, rating: null } }));
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Initial assessment failed');
    } finally {
      setIsResponding(false);
    }
  }, [isResponding, vehicle, mileage, codes, parameters, addChatMessage, ensureSession]);

  // Human feedback 👍/👎 — moves confidence of the knowledge the response used.
  // 👍 raises the SHIMI node (verified) and confirms any Claude-origin entries used.
  // 👎 lowers the node and removes the rejected Claude-origin entries.
  const rateMessage = useCallback((messageId: string, rating: Rating) => {
    setFeedback((f) => {
      const entry = f[messageId];
      if (!entry || entry.rating != null) return f; // no provenance, or already rated
      const { dtcId, claudeQueries } = entry.provenance;

      if (rating === 'up') {
        if (dtcId) shimiDataSource.confirmDtc(dtcId);
        claudeQueries.forEach((q) => claudeKnowledge.confirm(q));
      } else {
        if (dtcId) shimiDataSource.weakenDtc(dtcId);
        claudeQueries.forEach((q) => claudeKnowledge.reject(q));
      }

      return { ...f, [messageId]: { ...entry, rating } };
    });
  }, []);

  return {
    messages,
    isResponding,
    chatError,
    feedback,
    sendMessage,
    sendInitialAssessment,
    rateMessage,
  } as const;
}
