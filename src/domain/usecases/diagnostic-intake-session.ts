// Session state machine for the ADR-0009 pipeline:
//
//   intake (junior collects) → handoff (deterministic brief, ONE senior call)
//   → senior conducts to the end · every step logged append-only.
//
// The local LLM may phrase intake questions (InterviewerPort); the checklist
// (briefReadiness, G0) — not the LLM — decides when intake is complete. If the
// senior is unavailable at any point the session degrades to the local junior
// pipeline (previous behavior), never a dead end.

import { classifyQuery } from './query-router';
import type { ChatWithQVACInput } from './chat-with-qvac';
import type { MultiAgentChatResult } from './multi-agent-chat';
import { parseVehicleIdentity, ParsedVehicleIdentity } from '@/domain/services/vehicle-identity-parser';
import { matchSymptoms } from '@/domain/services/symptom-matcher';
import { buildBrief, briefReadiness, renderBriefPrompt } from '@/domain/services/brief-assembler';
import type { DiagnosticBrief, MissingField } from '@/domain/entities/diagnostic-brief';

// ─── Ports (effects stay outside; fakes in tests) ───────────────────────────

export interface SeniorAgentPort {
  isConfigured(): boolean;
  converse(
    history: readonly { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string>;
}

// Optional LLM phrasing of the next intake question. Any failure or slow reply
// degrades to a fixed template — completeness never depends on the model.
export interface InterviewerPort {
  phraseQuestion(missing: readonly MissingField[], knownSummary: string): Promise<string>;
}

export type TurnRole = 'user' | 'junior' | 'senior';

// Append-only case log (ADR-0009 Phase 3). Implementations must be
// fire-and-forget: persistence errors must never break the chat hot path.
export interface CaseLogPort {
  logTurn(sessionId: string, role: TurnRole, content: string): void;
  logBrief(sessionId: string, brief: DiagnosticBrief, prompt: string): void;
}

// Structural type of MultiAgentChatUseCase — the junior/local pipeline.
export interface JuniorChatPort {
  execute(input: ChatWithQVACInput): Promise<MultiAgentChatResult>;
}

// ─── Session state ───────────────────────────────────────────────────────────

// 'local_only': checklist done but senior unreachable/unconfigured, intake gave
// up, or senior failed mid-conversation → junior pipeline for the rest.
type Phase = 'intake' | 'senior' | 'local_only';

interface CaseState {
  phase: Phase;
  identity: ParsedVehicleIdentity | null;
  symptomIds: string[];
  notes: string[];
  questionsAsked: number;
  seniorHistory: { role: 'user' | 'assistant'; content: string }[];
}

const MAX_INTAKE_QUESTIONS = 4;   // then hand the case to the junior as-is
const MAX_SENIOR_TURNS = 20;      // cost cap per session (ADR-0009 risk table)
const INTERVIEWER_TIMEOUT_MS = 8000;
const MAX_NOTES = 10;

function freshCase(): CaseState {
  return {
    phase: 'intake',
    identity: null,
    symptomIds: [],
    notes: [],
    questionsAsked: 0,
    seniorHistory: [],
  };
}

// Latest non-null field wins, so the user can correct by restating
// ("no, es 2009" re-parses and overwrites the year).
function mergeIdentity(
  current: ParsedVehicleIdentity | null,
  parsed: ParsedVehicleIdentity,
): ParsedVehicleIdentity | null {
  if (current == null) {
    const empty = parsed.make == null && parsed.model == null
      && parsed.year == null && parsed.engine == null;
    return empty ? null : parsed;
  }
  return {
    make: parsed.make ?? current.make,
    model: parsed.model ?? current.model,
    year: parsed.year ?? current.year,
    engine: parsed.engine ?? current.engine,
  };
}

function knownSummary(brief: DiagnosticBrief): string {
  const { make, model, year } = brief.identity;
  const parts = [make, model, year != null ? String(year) : null].filter(
    (p): p is string => p != null,
  );
  return parts.join(' ');
}

function templateQuestion(missing: readonly MissingField[], known: string): string {
  if (missing.includes('make') || missing.includes('model') || missing.includes('year')) {
    const knownStr = known.length > 0 ? ` So far I have: ${known}.` : '';
    return (
      `Before I bring in the senior diagnostician, I need to know the vehicle.${knownStr} ` +
      `What is the make, model and year? (e.g. "Chevrolet Corsa 2008")`
    );
  }
  // Only obd_evidence left
  return (
    'I have the vehicle identity, but no OBD data yet. Please connect the adapter ' +
    'and read the trouble codes or live parameters from the Dashboard — the senior ' +
    'diagnosis is only worth doing with real vehicle-state data.'
  );
}

function localResult(text: string, isAiGenerated: boolean): MultiAgentChatResult {
  return { text, generatedAt: new Date(), isAiGenerated, source: 'carpsy' };
}

// ─── Use case ────────────────────────────────────────────────────────────────

export class DiagnosticIntakeSessionUseCase {
  private readonly cases = new Map<string, CaseState>();

  constructor(
    private readonly junior: JuniorChatPort,
    private readonly senior: SeniorAgentPort,
    private readonly caseLog: CaseLogPort,
    private readonly interviewer: InterviewerPort | null = null,
  ) {}

  async execute(sessionId: string, input: ChatWithQVACInput): Promise<MultiAgentChatResult> {
    const lastUserTurn = [...input.history].reverse().find((t) => t.role === 'user');
    const userText = lastUserTurn?.content ?? '';

    const existing = this.cases.get(sessionId);
    const state = existing ?? freshCase();

    if (userText) this.caseLog.logTurn(sessionId, 'user', userText);

    if (state.phase === 'senior') {
      return this.seniorTurn(sessionId, state, input, userText);
    }
    if (state.phase === 'local_only') {
      return this.juniorTurn(sessionId, input);
    }

    // ── Intake ──
    const isDiagnostic = classifyQuery(userText, input.troubleCodes.length > 0) === 'diagnostic';
    const intakeStarted = existing != null;
    if (!isDiagnostic && !intakeStarted) {
      // General chit-chat outside a diagnostic case: previous behavior, no state
      return this.juniorTurn(sessionId, input);
    }
    this.cases.set(sessionId, state);

    // Absorb evidence from this message
    state.identity = mergeIdentity(state.identity, parseVehicleIdentity(userText));
    for (const symptom of matchSymptoms(userText)) {
      if (!state.symptomIds.includes(symptom)) state.symptomIds.push(symptom);
    }
    if (userText && state.notes.length < MAX_NOTES) state.notes.push(userText);

    const brief = buildBrief({
      vehicle: input.vehicle,
      userIdentity: state.identity,
      mileageKm: input.mileage,
      troubleCodes: input.troubleCodes,
      parameters: input.parameters,
      symptomIds: state.symptomIds,
      userNotes: state.notes.join('\n'),
      now: Date.now(),
    });
    const readiness = briefReadiness(brief);

    if (readiness.ready) {
      return this.handoff(sessionId, state, input, brief);
    }

    if (state.questionsAsked >= MAX_INTAKE_QUESTIONS) {
      // Intake could not complete — stop interviewing, let the junior work
      // with whatever exists (honest degradation, never a dead end).
      state.phase = 'local_only';
      return this.juniorTurn(sessionId, input);
    }

    const question = await this.nextQuestion(readiness.missing, knownSummary(brief));
    state.questionsAsked += 1;
    this.caseLog.logTurn(sessionId, 'junior', question.text);
    return localResult(question.text, question.fromLlm);
  }

  // ── The one good call (ADR-0009 §3) ──
  private async handoff(
    sessionId: string,
    state: CaseState,
    input: ChatWithQVACInput,
    brief: DiagnosticBrief,
  ): Promise<MultiAgentChatResult> {
    if (!this.senior.isConfigured()) {
      state.phase = 'local_only';
      return this.juniorTurn(sessionId, input);
    }

    const prompt = renderBriefPrompt(brief);
    this.caseLog.logBrief(sessionId, brief, prompt);

    try {
      const history = [{ role: 'user' as const, content: prompt }];
      const reply = await this.senior.converse(history);
      state.seniorHistory = [...history, { role: 'assistant', content: reply }];
      state.phase = 'senior';
      this.caseLog.logTurn(sessionId, 'senior', reply);
      return {
        text: reply,
        generatedAt: new Date(),
        isAiGenerated: true,
        source: 'claude',
        retrieval: { dtcId: null, claudeQueries: [], usedUnverified: true },
      };
    } catch (err) {
      console.warn('[IntakeSession] senior handoff failed, degrading to local:', err);
      state.phase = 'local_only';
      return this.juniorTurn(sessionId, input);
    }
  }

  // ── Senior conducts to the end (ADR-0009 §3) ──
  private async seniorTurn(
    sessionId: string,
    state: CaseState,
    input: ChatWithQVACInput,
    userText: string,
  ): Promise<MultiAgentChatResult> {
    if (state.seniorHistory.length >= MAX_SENIOR_TURNS * 2) {
      const capMsg =
        'This diagnostic session reached its length limit. Please start a new ' +
        'session — the case so far is saved.';
      this.caseLog.logTurn(sessionId, 'junior', capMsg);
      return localResult(capMsg, false);
    }

    const history = [...state.seniorHistory, { role: 'user' as const, content: userText }];
    try {
      const reply = await this.senior.converse(history);
      state.seniorHistory = [...history, { role: 'assistant', content: reply }];
      this.caseLog.logTurn(sessionId, 'senior', reply);
      return {
        text: reply,
        generatedAt: new Date(),
        isAiGenerated: true,
        source: 'claude',
        retrieval: { dtcId: null, claudeQueries: [], usedUnverified: true },
      };
    } catch (err) {
      console.warn('[IntakeSession] senior turn failed, local fallback for this turn:', err);
      return this.juniorTurn(sessionId, input);
    }
  }

  private async juniorTurn(
    sessionId: string,
    input: ChatWithQVACInput,
  ): Promise<MultiAgentChatResult> {
    const result = await this.junior.execute(input);
    this.caseLog.logTurn(sessionId, 'junior', result.text);
    return result;
  }

  // LLM-phrased question with template fallback. The checklist already decided
  // WHAT is missing; the model only picks the words.
  private async nextQuestion(
    missing: readonly MissingField[],
    known: string,
  ): Promise<{ text: string; fromLlm: boolean }> {
    const template = templateQuestion(missing, known);
    if (this.interviewer == null) return { text: template, fromLlm: false };

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Timeout resolves empty (not reject) so the losing branch never leaves
      // an unhandled rejection behind; '' fails the sanity floor below.
      const phrased = await Promise.race([
        this.interviewer.phraseQuestion(missing, known),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve(''), INTERVIEWER_TIMEOUT_MS);
        }),
      ]);
      const clean = phrased.trim();
      // Sanity floor: a usable question is short-ish and actually a question.
      if (clean.length >= 10 && clean.length <= 300 && clean.includes('?')) {
        return { text: clean, fromLlm: true };
      }
      return { text: template, fromLlm: false };
    } catch {
      return { text: template, fromLlm: false };
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  }

  /** Drops the in-memory case (e.g. when a session ends). Logged data persists. */
  reset(sessionId: string): void {
    this.cases.delete(sessionId);
  }
}
