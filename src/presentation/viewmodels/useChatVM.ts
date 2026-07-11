// Manages multi-turn QVAC chat for an active diagnostic session.
// The first message is auto-sent by the system with vehicle + DTC context.

import { useState, useCallback } from 'react';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { container } from '@/data/container';
import { createChatMessage } from '@/domain/entities/chat-message';
import type { ChatSource } from '@/domain/entities/chat-message';
import type { ChatTurn, RetrievalProvenance } from '@/domain/repositories/i-llm.repository';

// Per-message provenance: what the response drew on (drives the inline
// "unverified suggestion" flag). The quality RATING is no longer captured here
// per message — it now lives on the case outcome in Reports (the stronger,
// car-verified signal), so this carries provenance only.
export interface MessageFeedback {
  readonly provenance: RetrievalProvenance;
}

export function useChatVM() {
  const [isResponding, setIsResponding] = useState(false);
  const [chatError, setChatError]       = useState<string | null>(null);
  // True while the case sits in 'awaiting_senior': the local diagnosis is done
  // and the user may summon the senior (Claude) — the ONLY path that spends tokens.
  const [seniorOffer, setSeniorOffer]   = useState(false);
  // messageId → provenance. Ephemeral (session-scoped); drives the inline
  // "unverified suggestion" flag only — the quality signal lives on the outcome.
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
      const assistantMsg = createChatMessage('assistant', result.text, source, result.gate);
      addChatMessage(assistantMsg);
      setSeniorOffer(result.seniorOffer === true);
      // Only diagnosis answers carry provenance (rateable); questions, greetings
      // and follow-up chatter don't — it drives the inline "unverified" flag.
      if (result.retrieval && result.rateable) {
        const prov = result.retrieval;
        setFeedback((f) => ({ ...f, [assistantMsg.id]: { provenance: prov } }));
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
      const assistantMsg = createChatMessage('assistant', result.text, source, result.gate);
      addChatMessage(assistantMsg);
      setSeniorOffer(result.seniorOffer === true);
      // Only diagnosis answers carry provenance (rateable); questions, greetings
      // and follow-up chatter don't — it drives the inline "unverified" flag.
      if (result.retrieval && result.rateable) {
        const prov = result.retrieval;
        setFeedback((f) => ({ ...f, [assistantMsg.id]: { provenance: prov } }));
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Initial assessment failed');
    } finally {
      setIsResponding(false);
    }
  }, [isResponding, vehicle, mileage, codes, parameters, addChatMessage, ensureSession]);

  // Fase 3 opt-in: the user taps "senior advisor" — the ONE Claude call with
  // the deterministic brief + junior hypothesis. Everything before this is free.
  const requestSeniorReview = useCallback(async () => {
    if (isResponding) return;
    const sessionId = useSessionStore.getState().activeSession?.id;
    if (sessionId == null) return;
    setChatError(null);
    setIsResponding(true);
    try {
      const history: ChatTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const result = await container.diagnosticSession.requestSenior(sessionId, {
        vehicle,
        mileage,
        troubleCodes: codes,
        parameters,
        history,
      });
      const source: ChatSource = 'source' in result ? result.source : 'carpsy';
      const assistantMsg = createChatMessage('assistant', result.text, source, result.gate);
      addChatMessage(assistantMsg);
      // On success the case moved to the senior phase → no offer; on failure
      // the use case keeps the offer alive so the user can retry.
      setSeniorOffer(result.seniorOffer === true);
      // Only diagnosis answers carry provenance (rateable); questions, greetings
      // and follow-up chatter don't — it drives the inline "unverified" flag.
      if (result.retrieval && result.rateable) {
        const prov = result.retrieval;
        setFeedback((f) => ({ ...f, [assistantMsg.id]: { provenance: prov } }));
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Senior review failed');
    } finally {
      setIsResponding(false);
    }
  }, [isResponding, messages, vehicle, mileage, codes, parameters, addChatMessage]);

  // Human feedback is captured once per case as the outcome in Reports
  // ("¿se resolvió?"), which moves SHIMI/Claude confidence from the car-verified
  // result (see ReportRepositoryImpl.saveOutcome) — a stronger signal than a
  // per-message thumb rated before the fix was ever tried.

  return {
    messages,
    isResponding,
    chatError,
    feedback,
    // A "+ new diagnosis" reset empties the messages; hide any stale offer.
    seniorOffer: seniorOffer && messages.length > 0,
    sendMessage,
    sendInitialAssessment,
    requestSeniorReview,
  } as const;
}
