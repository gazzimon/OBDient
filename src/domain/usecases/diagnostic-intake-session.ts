// Session state machine for the ADR-0009 pipeline, token-budget revision:
//
//   fase 1 — intake: deterministic ladder, template questions (0 tokens,
//     0 latency; the optional InterviewerPort re-phrasing is off by default).
//   fase 2 — local diagnosis: when the brief is ready, the on-device junior
//     (QVAC) issues a PRELIMINARY diagnosis from the same deterministic brief.
//     No cloud call. The session then waits in 'awaiting_senior'.
//   fase 3 — senior opt-in: Claude is called ONLY when the user explicitly
//     requests the senior review (requestSenior). One well-fed call carries
//     the brief + the junior hypothesis; the senior conducts from there.
//
//   Every step logged append-only.
//
// Intake v2 — "catalog, never discard":
//   - Question ladder: identity(+mileage+fuel) → OBD → open symptoms (hinted
//     by fault classes) → senses probe → conditions/history. The checklist
//     walks the ladder; the local LLM (InterviewerPort) only phrases the
//     question, with bilingual deterministic templates as the safety net.
//   - Owner words that match no taxonomy entry but have substance become
//     user-described symptoms (provenance: user) — they satisfy the interview
//     gate, reach the senior verbatim, and feed the symptom-candidate catalog.
//   - Negated symptoms are recorded as negative evidence, never as confirmed.
//   - If the interviewer LLM drifts into diagnosing, its output is logged as a
//     junior hypothesis (not shown) and the template question ships instead.

import type { ChatWithQVACInput } from './chat-with-qvac';
import type { MultiAgentChatResult } from './multi-agent-chat';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import { parseVehicleIdentity, ParsedVehicleIdentity } from '@/domain/services/vehicle-identity-parser';
import { matchSymptomsDetailed } from '@/domain/services/symptom-matcher';
import { faultClassClosure } from '@/domain/services/fault-class';
import {
  buildBrief,
  briefReadiness,
  hasObdEvidence,
  renderBriefPrompt,
  renderLocalDiagnosisPrompt,
} from '@/domain/services/brief-assembler';
import { symptomsForConcepts, SYMPTOM_MAP } from '@/data/knowledge/symptom-ontology';
import { redactText } from '@/core/utils/redact';
import type { DiagnosticBrief } from '@/domain/entities/diagnostic-brief';

// Ladder steps the intake may still need to walk. 'identity' groups
// make/model/year AND mileage (asked together, re-asked grouped) — all four are
// hard requirements now. Fuel type is requested in the same question but never
// blocks. OBD is no longer a ladder step: the case can be diagnosed from
// symptoms with the scanner mute (ADR-0006-A).
export type IntakeGap = 'identity' | 'symptoms' | 'senses' | 'conditions';

// ─── Ports (effects stay outside; fakes in tests) ───────────────────────────

export interface SeniorAgentPort {
  isConfigured(): boolean;
  converse(
    history: readonly { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string>;
}

// Optional LLM phrasing of the next intake question from a deterministic
// briefing block. Any failure or slow reply degrades to a fixed template —
// completeness never depends on the model.
export interface InterviewerPort {
  phraseQuestion(briefing: string): Promise<string>;
}

export type TurnRole = 'user' | 'junior' | 'senior';

// Append-only case log (ADR-0009 Phase 3). Implementations must be
// fire-and-forget: persistence errors must never break the chat hot path.
export interface CaseLogPort {
  logTurn(sessionId: string, role: TurnRole, content: string): void;
  logBrief(sessionId: string, brief: DiagnosticBrief, prompt: string): void;
  // Owner symptom descriptions that matched no taxonomy entry — raw material
  // for growing the symptom ontology (ADR-0006-A Phase 4 curation loop).
  logSymptomCandidate(sessionId: string, description: string): void;
}

// Structural type of MultiAgentChatUseCase — the junior/local pipeline.
export interface JuniorChatPort {
  execute(input: ChatWithQVACInput): Promise<MultiAgentChatResult>;
}

// ─── Session state ───────────────────────────────────────────────────────────

// awaiting_senior: the junior already diagnosed from the completed brief; the
// user can keep chatting locally or explicitly summon the senior (fase 3).
type Phase = 'intake' | 'awaiting_senior' | 'senior' | 'local_only';
type Lang = 'es' | 'en';

interface CaseState {
  phase: Phase;
  language: Lang;
  identity: ParsedVehicleIdentity | null;
  symptomIds: string[];
  deniedSymptomIds: string[];
  describedSymptoms: string[];
  notes: string[];
  questionsAsked: number;
  lastAskedGap: IntakeGap | null;
  symptomsProbeAsked: boolean;
  sensesProbeAsked: boolean;
  conditionsAsked: boolean;
  juniorDiagnosis: string | null;
  seniorHistory: { role: 'user' | 'assistant'; content: string }[];
}

const MAX_INTAKE_QUESTIONS = 6;   // ladder budget; then hand off if G0 holds
const MAX_SENIOR_TURNS = 20;      // cost cap per session (ADR-0009 risk table)
const INTERVIEWER_TIMEOUT_MS = 8000;
const MAX_NOTES = 12;

function freshCase(): CaseState {
  return {
    phase: 'intake',
    language: 'en',
    identity: null,
    symptomIds: [],
    deniedSymptomIds: [],
    describedSymptoms: [],
    notes: [],
    questionsAsked: 0,
    lastAskedGap: null,
    symptomsProbeAsked: false,
    sensesProbeAsked: false,
    conditionsAsked: false,
    juniorDiagnosis: null,
    seniorHistory: [],
  };
}

// ─── Deterministic language detection (template safety net only — the LLM
//     mirrors any language on its own) ─────────────────────────────────────

const ES_WORDS = new Set([
  'que', 'pero', 'tiene', 'esta', 'anda', 'los', 'las', 'se', 'mi', 'cuando', 'desde',
  'hace', 'muy', 'es', 'una', 'y', 'como', 'con',
  // Greetings/openers carry language even when the message names no symptom —
  // a bare "Hola" must land in Spanish, not the 'en' default (freshCase).
  'hola', 'buenas', 'buenos', 'gracias', 'necesito', 'tengo', 'quiero', 'ayuda', 'ayudame',
  // Symptom vocabulary is a strong language signal on short messages
  'arranca', 'enciende', 'tira', 'ruido', 'olor', 'humo', 'tiembla', 'apaga',
  'frio', 'caliente', 'ralenti', 'consume', 'pierde', 'recalienta',
]);
const EN_WORDS = new Set([
  'the', 'it', 'is', 'my', 'when', 'does', 'and', 'not', 'has', 'since', 'of', 'to',
  'on', 'car', 'runs', 'makes', 'start', 'smoke', 'noise', 'smell', 'idle', 'cold', 'shakes',
]);

function detectLanguage(text: string, previous: Lang): Lang {
  const lower = text.toLowerCase();
  if (/[¿¡ñ]|á|é|í|ó|ú/.test(lower)) return 'es';
  const words = lower.split(/[^a-z']+/).filter(Boolean);
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (ES_WORDS.has(w)) es++;
    if (EN_WORDS.has(w)) en++;
  }
  if (es > en) return 'es';
  if (en > es) return 'en';
  return previous;
}

// ─── Substance detector: did the answer describe anything? ──────────────────

const SUBSTANCE_STOPWORDS = new Set([
  'anda', 'pero', 'que', 'con', 'para', 'cuando', 'como', 'este', 'esta', 'hace',
  'auto', 'coche', 'carro', 'motor', 'algo', 'nada', 'explicar', 'creo', 'digo',
  'the', 'and', 'car', 'engine', 'this', 'that', 'like', 'know', 'explain', 'something',
  // Function words that carry no description
  'los', 'las', 'una', 'uno', 'del', 'por', 'mas', 'muy', 'eso', 'esa', 'ese',
  'has', 'have', 'was', 'were', 'you', 'your', 'its',
  // Commands/requests are not symptom descriptions
  'diagnose', 'diagnosis', 'codes', 'code', 'codigo', 'codigos', 'revisa', 'revisar',
  'check', 'help', 'ayuda', 'please', 'hola', 'tiene', 'problema', 'problem', 'falla', 'error', 'vin',
]);

function hasSubstance(text: string): boolean {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SUBSTANCE_STOPWORDS.has(w));
  return words.length >= 2;
}

// ─── Bilingual template ladder (the deterministic safety net) ────────────────

type IdentityField = 'make' | 'model' | 'year' | 'mileage';

const FIELD_NAMES: Readonly<Record<Lang, Record<IdentityField, string>>> = {
  es: { make: 'la marca', model: 'el modelo', year: 'el año', mileage: 'el kilometraje' },
  en: { make: 'the make', model: 'the model', year: 'the year', mileage: 'the mileage' },
};

function templateQuestion(
  lang: Lang,
  gap: IntakeGap,
  known: string,
  missing: readonly IdentityField[],
  symptomHints: readonly string[],
): string {
  if (lang === 'es') {
    switch (gap) {
      case 'identity':
        if (known.length > 0 && missing.length > 0 && missing.length < 4) {
          const list = missing.map((f) => FIELD_NAMES.es[f]).join(' y ');
          return `Ya tengo: ${known}. Me falta ${list} — ¿me lo pasás?`;
        }
        return (
          'Para empezar necesito conocer el vehículo. Contame marca, modelo, año, ' +
          'kilometraje y motor (nafta/diésel y cilindrada) — por ejemplo: ' +
          '"Chevrolet Corsa 1.6 nafta 2008, 150 mil km".'
        );
      case 'symptoms':
        return symptomHints.length > 0
          ? `Contame qué está pasando con el auto — necesito al menos un síntoma concreto para diagnosticar. Por los códigos leídos suele aparecer: ${symptomHints.join('; ')}. ¿Notás alguno, o algo distinto? Decime cuándo pasa y cómo se siente.`
          : 'Contame qué está pasando con el auto — necesito al menos un síntoma concreto. ¿Qué hace exactamente: ruido, tirón, humo, olor, falta de fuerza, se apaga? Dame el detalle: cuándo pasa y qué sentís.';
      case 'senses':
        return (
          'Vamos por partes así lo agarramos. ¿ESCUCHÁS algo raro (golpeteo, silbido, ' +
          'chillido)? ¿HUELE a algo (nafta, quemado, dulce)? ¿VES humo por el escape ' +
          '(blanco, azul, negro) o alguna luz del tablero? ¿SENTÍS tirones, vibración ' +
          'o falta de fuerza? Con que me digas una sola ya avanzamos.'
        );
      case 'conditions':
        return (
          'Buenísimo, lo último para afinar el caso: ¿desde cuándo pasa, y en qué ' +
          'condiciones — en frío, en caliente, en ralentí o acelerando? ¿Le hicieron ' +
          'alguna reparación hace poco?'
        );
    }
  }
  switch (gap) {
    case 'identity':
      if (known.length > 0 && missing.length > 0 && missing.length < 4) {
        const list = missing.map((f) => FIELD_NAMES.en[f]).join(' and ');
        return `So far I have: ${known}. I still need ${list} — could you tell me?`;
      }
      return (
        'To get started I need to know the vehicle. Tell me the make, model, year, ' +
        'mileage and engine (petrol/diesel and displacement) — for example: ' +
        '"Chevrolet Corsa 1.6 petrol 2008, 150,000 km".'
      );
    case 'symptoms':
      return symptomHints.length > 0
        ? `Tell me what's actually going on — I need at least one concrete symptom to diagnose. With the codes we read, the usual signs are: ${symptomHints.join('; ')}. Do you get any of those, or something else? Tell me when it happens and how it feels.`
        : "Tell me what's actually going on — I need at least one concrete symptom. What does it do exactly: noise, jerk, smoke, smell, power loss, stalling? Give me the detail: when it happens and what you feel.";
    case 'senses':
      return (
        "Let's go sense by sense so we catch it. Do you HEAR anything odd (knocking, " +
        'hissing, squealing)? Does it SMELL of anything (fuel, burnt, sweet)? Do you ' +
        'SEE smoke from the exhaust (white, blue, black) or a dashboard light? Do you ' +
        'FEEL jerking, shaking or power loss? Even one of these moves us forward.'
      );
    case 'conditions':
      return (
        'Great — last bit to sharpen the case: since when does this happen, and under ' +
        'what conditions — cold start, warmed up, idling or accelerating? Any recent ' +
        'repairs or part changes?'
      );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Latest non-null field wins, so the user can correct by restating.
function mergeIdentity(
  current: ParsedVehicleIdentity | null,
  parsed: ParsedVehicleIdentity,
): ParsedVehicleIdentity | null {
  if (current == null) {
    const empty = Object.values(parsed).every((v) => v == null);
    return empty ? null : parsed;
  }
  return {
    make: parsed.make ?? current.make,
    model: parsed.model ?? current.model,
    year: parsed.year ?? current.year,
    engine: parsed.engine ?? current.engine,
    mileageKm: parsed.mileageKm ?? current.mileageKm,
    fuelType: parsed.fuelType ?? current.fuelType,
  };
}

function knownSummary(brief: DiagnosticBrief): string {
  const { make, model, year } = brief.identity;
  const parts = [make, model, year != null ? String(year) : null].filter(
    (p): p is string => p != null,
  );
  return parts.join(' ');
}

// Symptoms worth probing for the active DTCs (ADR-0006-A pre-filter), minus
// what the owner already reported or denied.
function candidateSymptomLabels(
  dtcs: readonly TroubleCode[],
  excluded: readonly string[],
): string[] {
  const concepts = new Set<string>();
  for (const dtc of dtcs) {
    for (const node of faultClassClosure(dtc.code)) concepts.add(node.id);
  }
  return symptomsForConcepts([...concepts])
    .filter((id) => !excluded.includes(id))
    .slice(0, 3)
    .map((id) => SYMPTOM_MAP[id]?.label)
    .filter((label): label is string => label != null);
}

const GAP_OBJECTIVES: Readonly<Record<IntakeGap, string>> = {
  identity: 'the vehicle identity: make, model, year, mileage (all required), engine/fuel type',
  symptoms: 'at least one concrete symptom the owner notices — press for specifics (offer the example symptoms as choices)',
  senses: 'symptoms through the senses: noises, smells, smoke color, dashboard lights, feel (jerk/shake/power loss)',
  conditions: 'since when it happens, conditions (cold/hot, idle/accelerating), recent repairs',
};

// Deterministic briefing block the LLM phrases its question from.
function buildBriefing(
  state: CaseState,
  brief: DiagnosticBrief,
  gap: IntakeGap,
  symptomHints: readonly string[],
): string {
  const lines: string[] = ['CASE FILE so far:'];
  const id = knownSummary(brief);
  lines.push(`- Vehicle: ${id.length > 0 ? id : 'unknown'}`);
  if (brief.dtcs.length > 0) {
    lines.push(`- Codes read: ${brief.dtcs.map((d) => d.code).join(', ')}`);
  }
  if (brief.symptoms.length > 0) {
    lines.push(`- Symptoms confirmed: ${brief.symptoms.map((s) => s.label).join('; ')}`);
  }
  if (state.describedSymptoms.length > 0) {
    lines.push(`- Owner described: ${state.describedSymptoms.map((d) => `"${d}"`).join(' / ')}`);
  }
  const lastWords = state.notes[state.notes.length - 1];
  if (lastWords != null) lines.push(`- Owner's last message: "${lastWords}"`);
  lines.push(`- Owner language: ${state.language === 'es' ? 'Spanish' : 'English'}`);
  lines.push('', `OBJECTIVE — obtain: ${GAP_OBJECTIVES[gap]}.`);
  if (gap === 'symptoms' && symptomHints.length > 0) {
    lines.push(`LIKELY SYMPTOMS for these codes (offer as examples): ${symptomHints.join('; ')}.`);
  }
  lines.push('', "Ask your ONE next question now, in the owner's language.");
  return lines.join('\n');
}

function localResult(
  text: string,
  isAiGenerated: boolean,
  seniorOffer = false,
): MultiAgentChatResult {
  return {
    text,
    generatedAt: new Date(),
    isAiGenerated,
    source: 'carpsy',
    ...(seniorOffer ? { seniorOffer: true } : {}),
  };
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
    if (state.phase === 'awaiting_senior') {
      // Fase 2 done: the junior diagnosed. Follow-up chat stays local; new
      // details keep enriching the case so a later senior call gets them.
      this.absorb(sessionId, state, userText);
      const result = await this.juniorTurn(sessionId, input);
      return this.senior.isConfigured() ? { ...result, seniorOffer: true } : result;
    }

    // ── Intake (fase 1 — deterministic, zero tokens) ──
    // The Diagnosis chat IS the intake: every message enters the deterministic
    // ladder from the very first turn — greetings included. Nothing is handed
    // to the free-form on-device model here, which would hallucinate a diagnosis
    // and drift out of the owner's language before the case even exists (the
    // "it answers before interviewing" regression). The tiny model only speaks
    // in fase 2, fed the structured brief.
    //
    // The interview runs even without a senior configured: the brief also
    // feeds the junior's local diagnosis (fase 2), which works offline.
    this.cases.set(sessionId, state);
    this.absorb(sessionId, state, userText);

    const brief = buildBrief({
      vehicle: input.vehicle,
      userIdentity: state.identity,
      mileageKm: input.mileage,
      troubleCodes: input.troubleCodes,
      parameters: input.parameters,
      symptomIds: state.symptomIds,
      describedSymptoms: state.describedSymptoms,
      deniedSymptomIds: state.deniedSymptomIds,
      userNotes: state.notes.join('\n'),
      now: Date.now(),
    });
    const hard = briefReadiness(brief);   // make + model + year + mileage

    // Evidence to diagnose from: a reported symptom (mandatory path) or, if the
    // owner truly can't produce one, whatever the scanner gave us.
    const symptomCount = state.symptomIds.length + state.describedSymptoms.length;
    const hasSymptom = symptomCount > 0;
    const obdPresent = hasObdEvidence(brief);

    // Interview sufficiency: vehicle facts complete + at least one symptom +
    // the conditions exchange. If both symptom probes came up empty we stop
    // pressing (honest exhaustion) rather than re-asking forever.
    const probesExhausted = state.symptomsProbeAsked && state.sensesProbeAsked;
    const interviewDone = hasSymptom ? state.conditionsAsked : probesExhausted;

    if (hard.ready && interviewDone) {
      // Diagnose when there is anything to diagnose from (symptom OR OBD).
      if (hasSymptom || obdPresent) {
        return this.localDiagnosis(sessionId, state, input, brief);
      }
      // Vehicle facts OK but zero evidence — nothing to diagnose. Plain chat.
      state.phase = 'local_only';
      return this.juniorTurn(sessionId, input);
    }

    if (state.questionsAsked >= MAX_INTAKE_QUESTIONS) {
      // The owner won't give more. Diagnose if the facts hold and there is any
      // evidence; otherwise degrade to plain local chat.
      if (hard.ready && (hasSymptom || obdPresent)) {
        return this.localDiagnosis(sessionId, state, input, brief);
      }
      state.phase = 'local_only';
      return this.juniorTurn(sessionId, input);
    }

    // ── Pick the next ladder step ──
    // Identity gap covers make/model/year AND mileage — all four block.
    const missingIdentity = hard.missing.filter(
      (m): m is IdentityField =>
        m === 'make' || m === 'model' || m === 'year' || m === 'mileage',
    );
    let gap: IntakeGap;
    if (missingIdentity.length > 0) gap = 'identity';
    else if (!hasSymptom) gap = state.symptomsProbeAsked ? 'senses' : 'symptoms';
    else gap = 'conditions';

    if (gap === 'symptoms') state.symptomsProbeAsked = true;
    if (gap === 'senses') state.sensesProbeAsked = true;
    if (gap === 'conditions') state.conditionsAsked = true;
    state.lastAskedGap = gap;
    state.questionsAsked += 1;

    const hints = gap === 'symptoms' || gap === 'senses'
      ? candidateSymptomLabels(input.troubleCodes, [...state.symptomIds, ...state.deniedSymptomIds])
      : [];
    const question = await this.nextQuestion(sessionId, state, brief, gap, missingIdentity, hints);
    this.caseLog.logTurn(sessionId, 'junior', question.text);
    return localResult(question.text, question.fromLlm);
  }

  // Absorbs one owner message into the case: language, identity, symptoms
  // (confirmed / denied / user-described), notes. Nothing is discarded.
  private absorb(sessionId: string, state: CaseState, userText: string): void {
    if (!userText) return;
    state.language = detectLanguage(userText, state.language);

    const parsed = parseVehicleIdentity(userText);
    // The parser's model heuristic grabs leading words from ANY sentence, so a
    // message only counts as an identity answer when it is anchored by a hard
    // field (make/year/engine/mileage/fuel) or directly answers the identity
    // question — otherwise "tiembla en frío" would overwrite the model name.
    const anchored =
      parsed.make != null || parsed.year != null || parsed.engine != null ||
      parsed.mileageKm != null || parsed.fuelType != null;
    const isIdentityAnswer = anchored || state.lastAskedGap === 'identity';
    if (isIdentityAnswer) {
      state.identity = mergeIdentity(state.identity, parsed);
    }

    const matched = matchSymptomsDetailed(userText);
    for (const id of matched.confirmed) {
      if (!state.symptomIds.includes(id)) state.symptomIds.push(id);
      const idx = state.deniedSymptomIds.indexOf(id);
      if (idx >= 0) state.deniedSymptomIds.splice(idx, 1); // affirmation wins
    }
    for (const id of matched.denied) {
      if (!state.symptomIds.includes(id) && !state.deniedSymptomIds.includes(id)) {
        state.deniedSymptomIds.push(id);
      }
    }

    // Catalog, never discard: a substantive description that matched nothing
    // becomes a user-reported symptom and a taxonomy candidate. Only in
    // symptom context — answers to the conditions question are context and go
    // to notes, not to the symptom catalog.
    const symptomContext =
      state.lastAskedGap == null ||
      state.lastAskedGap === 'symptoms' ||
      state.lastAskedGap === 'senses';
    if (
      symptomContext && !isIdentityAnswer &&
      matched.confirmed.length === 0 && hasSubstance(userText)
    ) {
      if (!state.describedSymptoms.includes(userText)) {
        state.describedSymptoms.push(userText);
        this.caseLog.logSymptomCandidate(sessionId, userText);
      }
    }

    if (state.notes.length < MAX_NOTES) state.notes.push(userText);
  }

  // ── Fase 2: preliminary diagnosis by the on-device junior (0 cloud tokens) ──
  private async localDiagnosis(
    sessionId: string,
    state: CaseState,
    input: ChatWithQVACInput,
    brief: DiagnosticBrief,
  ): Promise<MultiAgentChatResult> {
    state.phase = 'awaiting_senior';
    const prompt = renderLocalDiagnosisPrompt(brief, state.language);
    try {
      const result = await this.junior.execute({
        ...input,
        history: [{ role: 'user', content: prompt }],
      });
      state.juniorDiagnosis = result.text;
      this.caseLog.logTurn(sessionId, 'junior', result.text);
      // A diagnosis is rateable (one 👍/👎 in the chat); the senior offer rides
      // along when Claude is available.
      return this.senior.isConfigured()
        ? { ...result, rateable: true, seniorOffer: true }
        : { ...result, rateable: true };
    } catch (err) {
      console.warn('[IntakeSession] local diagnosis failed:', err);
      const msg = state.language === 'es'
        ? 'No pude generar el diagnóstico local. Podés consultar al asesor senior o intentar de nuevo.'
        : 'I could not generate the local diagnosis. You can consult the senior advisor or try again.';
      this.caseLog.logTurn(sessionId, 'junior', msg);
      return localResult(msg, false, this.senior.isConfigured());
    }
  }

  // ── Fase 3: the one good senior call, ONLY on explicit user request ──
  // Rebuilds the brief from the current state (anything said after the local
  // diagnosis travels too) and appends the junior hypothesis for the senior
  // to confirm or correct.
  async requestSenior(sessionId: string, input: ChatWithQVACInput): Promise<MultiAgentChatResult> {
    const state = this.cases.get(sessionId);
    if (state == null || state.phase !== 'awaiting_senior') {
      return localResult('The senior review is only available after a completed local diagnosis.', false);
    }
    if (!this.senior.isConfigured()) {
      const msg = state.language === 'es'
        ? 'El asesor senior no está configurado. Agregá tu clave de Claude en Settings.'
        : 'The senior advisor is not configured. Add your Claude API key in Settings.';
      return localResult(msg, false);
    }

    this.caseLog.logTurn(sessionId, 'user', '[owner requested the senior review]');

    const brief = buildBrief({
      vehicle: input.vehicle,
      userIdentity: state.identity,
      mileageKm: input.mileage,
      troubleCodes: input.troubleCodes,
      parameters: input.parameters,
      symptomIds: state.symptomIds,
      describedSymptoms: state.describedSymptoms,
      deniedSymptomIds: state.deniedSymptomIds,
      userNotes: state.notes.join('\n'),
      now: Date.now(),
    });

    let prompt = renderBriefPrompt(brief);
    if (state.juniorDiagnosis != null) {
      prompt += [
        '',
        '',
        '## Local assistant hypothesis (verify or correct)',
        'A small on-device model gave the owner this preliminary read:',
        `"${state.juniorDiagnosis}"`,
      ].join('\n');
    }
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
        rateable: true, // the senior's diagnosis gets the single thumb
        retrieval: { dtcId: null, claudeQueries: [], usedUnverified: true },
      };
    } catch (err) {
      console.warn('[IntakeSession] senior request failed, staying local:', err);
      const msg = state.language === 'es'
        ? 'No pude contactar al asesor senior — revisá tu conexión e intentá de nuevo.'
        : 'I could not reach the senior advisor — check your connection and try again.';
      this.caseLog.logTurn(sessionId, 'junior', msg);
      return localResult(msg, false, true); // the offer stays available
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
      const capMsg = state.language === 'es'
        ? 'Esta sesión de diagnóstico llegó a su límite. Empezá una nueva — el caso queda guardado.'
        : 'This diagnostic session reached its length limit. Please start a new one — the case is saved.';
      this.caseLog.logTurn(sessionId, 'junior', capMsg);
      return localResult(capMsg, false);
    }
    state.language = detectLanguage(userText, state.language);

    // Redact VIN / plate / email from every follow-up turn before it leaves the
    // device (ADR-0009 data contract; audit M3). The initial brief is already
    // redacted by construction in brief-assembler; this closes the free-text
    // follow-ups. Stored redacted so later turns reuse the clean history.
    const history = [...state.seniorHistory, { role: 'user' as const, content: redactText(userText) }];
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

  // LLM-phrased question with a bilingual template fallback. The ladder
  // already decided WHAT to ask; the model only picks the words. An LLM output
  // that is not a question (e.g. it started diagnosing) is cataloged as a
  // junior hypothesis — never shown, never lost — and the template ships.
  private async nextQuestion(
    sessionId: string,
    state: CaseState,
    brief: DiagnosticBrief,
    gap: IntakeGap,
    missingIdentity: readonly IdentityField[],
    symptomHints: readonly string[],
  ): Promise<{ text: string; fromLlm: boolean }> {
    const template = templateQuestion(
      state.language, gap, knownSummary(brief), missingIdentity, symptomHints,
    );
    if (this.interviewer == null) return { text: template, fromLlm: false };

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Timeout resolves empty (not reject) so the losing branch never leaves
      // an unhandled rejection behind; '' fails the checks below.
      const phrased = await Promise.race([
        this.interviewer.phraseQuestion(buildBriefing(state, brief, gap, symptomHints)),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve(''), INTERVIEWER_TIMEOUT_MS);
        }),
      ]);
      const clean = phrased.trim();
      if (clean.length >= 10 && clean.length <= 300 && clean.includes('?')) {
        return { text: clean, fromLlm: true };
      }
      if (clean.length > 0) {
        // Drifted into prose/diagnosis: catalog as junior hypothesis, not shown
        this.caseLog.logTurn(
          sessionId, 'junior', `[hypothesis — not shown to owner] ${clean.slice(0, 300)}`,
        );
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
