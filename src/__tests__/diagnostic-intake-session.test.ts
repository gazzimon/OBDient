// Tests for the ADR-0009 session state machine, token-budget revision:
// fase 1 — deterministic ladder interview (identity → OBD → symptoms →
// senses → conditions), bilingual templates, "catalog never discard";
// fase 2 — local (junior) diagnosis from the completed brief, NO cloud call;
// fase 3 — senior (Claude) reached ONLY via explicit requestSenior().
// All ports are fakes — no network, no DB, no model.

import {
  DiagnosticIntakeSessionUseCase,
  SeniorAgentPort,
  CaseLogPort,
  JuniorChatPort,
  InterviewerPort,
} from '@/domain/usecases/diagnostic-intake-session';
import type { ChatWithQVACInput } from '@/domain/usecases/chat-with-qvac';
import type { MultiAgentChatResult } from '@/domain/usecases/multi-agent-chat';
import type { Vehicle } from '@/domain/entities/vehicle';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameter } from '@/domain/entities/obd-parameter';
import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import type { DtcSeverity } from '@/core/utils/dtcParser';

const T0 = new Date('2026-07-01T12:00:00Z');

function dtc(code: string, severity: DtcSeverity = 'critical'): TroubleCode {
  return { id: `${code}-t`, code, system: 'P', description: `test ${code}`, severity, detectedAt: T0, interpretation: null };
}

function param(pid: PidId, value: number): ObdParameter {
  const def = PID_DEFINITIONS[pid];
  return { pid, name: def.name, value, unit: def.unit, timestamp: T0, alert: null };
}

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v', make: 'Chevrolet', model: 'Corsa', year: 2008, vin: '3G1SF21649S123456',
    manufacturer: null, plantCountry: null, protocol: 'AUTO', adapterAddress: 'x', connectedAt: T0,
    ...overrides,
  };
}

function input(userText: string, overrides: Partial<ChatWithQVACInput> = {}): ChatWithQVACInput {
  return {
    vehicle: null,
    mileage: null,
    troubleCodes: [],
    parameters: {},
    history: [{ role: 'user', content: userText }],
    ...overrides,
  };
}

function fakeJunior(reply = 'junior reply'): JuniorChatPort & { calls: ChatWithQVACInput[] } {
  const calls: ChatWithQVACInput[] = [];
  return {
    calls,
    async execute(i: ChatWithQVACInput): Promise<MultiAgentChatResult> {
      calls.push(i);
      return { text: reply, generatedAt: new Date(), isAiGenerated: true, source: 'carpsy' };
    },
  };
}

// The prompt the junior received on call #i (the brief travels as history[0]).
function juniorPrompt(junior: ReturnType<typeof fakeJunior>, i = 0): string {
  return junior.calls[i]?.history[0]?.content ?? '';
}

function fakeSenior(configured = true, reply?: string): SeniorAgentPort & {
  calls: { role: string; content: string }[][];
  failNext: { value: boolean };
} {
  const calls: { role: string; content: string }[][] = [];
  const failNext = { value: false };
  return {
    calls,
    failNext,
    isConfigured: () => configured,
    async converse(history) {
      if (failNext.value) throw new Error('network down');
      calls.push(history.map((t) => ({ ...t })));
      return reply ?? `senior reply #${calls.length}`;
    },
  };
}

function fakeLog(): CaseLogPort & {
  turns: { role: string; content: string; gate?: { passed: boolean } }[];
  briefs: { prompt: string }[];
  candidates: string[];
} {
  const turns: { role: string; content: string; gate?: { passed: boolean } }[] = [];
  const briefs: { prompt: string }[] = [];
  const candidates: string[] = [];
  return {
    turns,
    briefs,
    candidates,
    logTurn: (_s, role, content, gate) => { turns.push({ role, content, ...(gate ? { gate } : {}) }); },
    logBrief: (_s, _b, prompt) => { briefs.push({ prompt }); },
    logSymptomCandidate: (_s, description) => { candidates.push(description); },
  };
}

// A case whose vehicle facts are already complete (VIN identity + mileage), so
// the ladder goes straight to the symptom probe.
const fullCase = (text: string, codes: TroubleCode[] = [dtc('P0302')]) =>
  input(text, {
    vehicle: vehicle(), mileage: 150000, troubleCodes: codes, parameters: { RPM: param('RPM', 850) },
  });

describe('intake phase — ladder (fase 1, deterministic)', () => {
  it('intake owns the diagnosis chat from the first message — even a bare greeting', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());

    // A greeting with no vehicle/DTCs must NOT reach the free-form model (which
    // would hallucinate a diagnosis in the wrong language). The deterministic
    // ladder answers instantly with the Spanish identity question.
    const res = await uc.execute('s1', input('hola'));
    expect(res.source).toBe('carpsy');
    expect(res.text).toContain('marca, modelo, año'); // Spanish identity template
    expect(junior.calls).toHaveLength(0);             // the tiny model never sees it
    expect(senior.calls).toHaveLength(0);
  });

  it('Q1 asks for the full vehicle identity, in the owner language (es)', async () => {
    const junior = fakeJunior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), log);

    const res = await uc.execute('s1', input('mi auto no arranca', { troubleCodes: [dtc('P0335')] }));
    expect(res.source).toBe('carpsy');
    // Spanish template, asking for everything at once
    expect(res.text).toContain('marca, modelo, año');
    expect(res.text).toContain('kilometraje');
    expect(junior.calls).toHaveLength(0); // intake owns the turn
    expect(log.turns.map((t) => t.role)).toEqual(['user', 'junior']);
  });

  it('asks the intake question in Portuguese when the language is pinned (pt)', async () => {
    const junior = fakeJunior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), fakeLog());

    const res = await uc.execute('s1', input('meu carro nao liga', { language: 'pt' }));
    expect(res.text).toContain('marca, modelo, ano'); // PT identity template
    expect(junior.calls).toHaveLength(0);
  });

  it('detects Portuguese from the owner text (ç/ã short-circuit)', async () => {
    const junior = fakeJunior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), fakeLog());

    const res = await uc.execute('s1', input('meu carro está com barulho e fumaça'));
    expect(res.text).toContain('marca, modelo, ano'); // PT template via detection
  });

  it('full interview ends in a LOCAL diagnosis with the senior offer — Claude is NOT called', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());
    const codes = [dtc('P0335')];

    // Symptom arrives in msg 1 ("no arranca"); identity is asked
    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    // Identity answered (mileage + fuel included) → conditions question
    const q2 = await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    expect(q2.text).toContain('desde cuándo');
    // Conditions answered → fase 2: junior diagnosis from the brief
    const res = await uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBe(true);
    expect(senior.calls).toHaveLength(0); // no auto-handoff, ever

    // The junior got the deterministic case file, not the raw chat
    const prompt = juniorPrompt(junior);
    expect(prompt).toContain('PRELIMINARY');
    expect(prompt).toContain('Chevrolet Corsa 2008');
    expect(prompt).toContain('P0335');
    expect(prompt).toContain('Reply in Spanish');
  });

  it('cloud source closes the intake with the senior offer — no local diagnosis (Beta V2 §2.5)', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior(); // configured
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());
    const codes = [dtc('P0335')];
    const cloud = { troubleCodes: codes, seniorSource: 'cloud' as const };

    await uc.execute('s1', input('no arranca', cloud));
    await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', cloud));
    const res = await uc.execute('s1', input('desde hace una semana, en frio', cloud));

    // The intake closes with the senior offer; the slow on-device model is skipped
    // and the senior is only called on explicit opt-in (requestSenior).
    expect(res.seniorOffer).toBe(true);
    expect(junior.calls).toHaveLength(0);
    expect(senior.calls).toHaveLength(0);
  });

  it('requestSenior makes the ONE senior call: brief + interview answers + junior hypothesis', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, log);
    const codes = [dtc('P0335')];

    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    await uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));

    const res = await uc.requestSenior('s1', input('', { troubleCodes: codes }));
    expect(res.source).toBe('claude');
    expect(senior.calls).toHaveLength(1);

    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('Chevrolet Corsa 2008');
    expect(prompt).toContain('petrol');
    expect(prompt).toContain('Odometer: 150000 km');
    expect(prompt).toContain('P0335');
    expect(prompt).toContain('Engine does not start');
    expect(prompt).toContain('desde hace una semana'); // interview answers travel
    expect(prompt).toContain('junior reply');           // junior hypothesis travels
    expect(log.briefs).toHaveLength(1);
  });

  it('VIN + DTCs still get interviewed: symptom probe (hinted) then conditions', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());

    const q1 = await uc.execute('s1', fullCase('diagnose my codes'));
    expect(senior.calls).toHaveLength(0);
    expect(q1.text).toContain('Rough / shaky idle'); // hint from P0302's fault class

    const q2 = await uc.execute('s1', fullCase('tiembla en ralenti y titila el check'));
    expect(q2.text).toContain('desde cuándo'); // language followed the owner

    const res = await uc.execute('s1', fullCase('desde ayer, en frio'));
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBe(true);

    await uc.requestSenior('s1', fullCase(''));
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('Rough / shaky idle');
    expect(prompt).toContain('Check engine light FLASHING');
  });

  it('symptoms given upfront still get the conditions question', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    const q1 = await uc.execute('s1', fullCase('mi auto tiembla en ralenti'));
    expect(q1.text).toContain('desde cuándo');
    const res = await uc.execute('s1', fullCase('desde hace una semana, en frio'));
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBe(true);
  });

  it('catalogs substantive descriptions that match no taxonomy entry (never discards)', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);

    await uc.execute('s1', fullCase('diagnose my codes'));            // symptom probe
    await uc.execute('s1', fullCase('se sacude al acelerar en subida')); // no keyword match
    expect(log.candidates).toEqual(['se sacude al acelerar en subida']);

    await uc.execute('s1', fullCase('desde ayer'));                   // conditions answered
    await uc.requestSenior('s1', fullCase(''));
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('se sacude al acelerar en subida'); // user-described travels
  });

  it('denied symptoms become negative evidence in the brief', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    await uc.execute('s1', fullCase('tiembla en ralenti pero no tira humo azul'));
    const res = await uc.execute('s1', fullCase('desde hace un mes, siempre'));
    expect(res.seniorOffer).toBe(true);

    await uc.requestSenior('s1', fullCase(''));
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('DENIED');
    expect(prompt).toContain('Blue smoke');
  });

  it('an owner who cannot describe symptoms exhausts both probes, then the junior diagnoses', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());
    const vague = () => fullCase('anda raro pero no se explicar');

    const q1 = await uc.execute('s1', vague()); // open symptoms probe
    const q2 = await uc.execute('s1', vague()); // senses probe
    expect(q1.source).toBe('carpsy');
    expect(q2.source).toBe('carpsy');
    const res = await uc.execute('s1', vague()); // probes exhausted, G0 holds
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBe(true);
    expect(senior.calls).toHaveLength(0);
    expect(juniorPrompt(junior)).toContain('PRELIMINARY');
  });

  it('gives up after the question cap when the hard G0 never completes', async () => {
    const junior = fakeJunior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), fakeLog());

    for (let i = 0; i < 6; i++) {
      const res = await uc.execute('s1', input('no se que auto es', { troubleCodes: [dtc('P0300')] }));
      expect(res.source).toBe('carpsy');
    }
    const res = await uc.execute('s1', input('sigue igual', { troubleCodes: [dtc('P0300')] }));
    expect(res.text).toBe('junior reply');
    expect(junior.calls).toHaveLength(1);
  });

  it('the brief prompt sent to the senior never contains the VIN', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    await uc.execute('s1', fullCase('mi vin es 3G1SF21649S123456, revisa los codigos'));
    await uc.execute('s1', fullCase('tiembla en ralenti'));
    await uc.execute('s1', fullCase('desde ayer'));
    await uc.requestSenior('s1', fullCase(''));

    expect(senior.calls).toHaveLength(1);
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toContain('3G1SF21649S123456');
  });

  it('without a senior configured the interview still runs and the junior diagnoses — no offer', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior(false);
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());

    const q1 = await uc.execute('s1', fullCase('tiembla en ralenti'));
    expect(q1.text).toContain('desde cuándo'); // interview happens offline too
    const res = await uc.execute('s1', fullCase('desde ayer'));
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBeUndefined();

    const denied = await uc.requestSenior('s1', fullCase(''));
    expect(denied.source).toBe('carpsy');
    expect(senior.calls).toHaveLength(0);
  });
});

describe('awaiting_senior phase (fase 2 → fase 3 boundary)', () => {
  async function toAwaiting(senior: ReturnType<typeof fakeSenior>, junior = fakeJunior(), log = fakeLog()) {
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, log);
    await uc.execute('s1', fullCase('diagnose'));                 // → symptom probe
    await uc.execute('s1', fullCase('tiembla en ralenti'));       // → conditions
    await uc.execute('s1', fullCase('desde ayer, en frio'));      // → junior diagnosis
    return uc;
  }

  it('follow-up chat stays local and keeps offering the senior', async () => {
    const senior = fakeSenior();
    const junior = fakeJunior();
    const uc = await toAwaiting(senior, junior);

    const res = await uc.execute('s1', fullCase('y puede ser la bujia?'));
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBe(true);
    expect(senior.calls).toHaveLength(0);
  });

  it('details added after the local diagnosis reach the senior brief', async () => {
    const senior = fakeSenior();
    const uc = await toAwaiting(senior);

    await uc.execute('s1', fullCase('ah y tira humo negro'));
    await uc.requestSenior('s1', fullCase(''));
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('Black smoke');
  });

  it('a failed senior request keeps the offer alive (retryable)', async () => {
    const senior = fakeSenior();
    const uc = await toAwaiting(senior);

    senior.failNext.value = true;
    const res = await uc.requestSenior('s1', fullCase(''));
    expect(res.source).toBe('carpsy');
    expect(res.seniorOffer).toBe(true);

    senior.failNext.value = false;
    const res2 = await uc.requestSenior('s1', fullCase(''));
    expect(res2.source).toBe('claude');
  });

  it('requestSenior without a completed case is a no-op guard', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());
    const res = await uc.requestSenior('nope', fullCase(''));
    expect(res.source).toBe('carpsy');
    expect(senior.calls).toHaveLength(0);
  });
});

describe('senior phase (after opt-in)', () => {
  async function toSeniorPhase(senior: ReturnType<typeof fakeSenior>, log = fakeLog()) {
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);
    await uc.execute('s1', fullCase('diagnose'));                 // → symptom probe
    await uc.execute('s1', fullCase('tiembla en ralenti'));       // → conditions
    await uc.execute('s1', fullCase('desde ayer, en frio'));      // → junior diagnosis
    await uc.requestSenior('s1', fullCase(''));                   // → fase 3 opt-in
    return uc;
  }

  it('after the opt-in the senior conducts the conversation with full history', async () => {
    const senior = fakeSenior();
    const uc = await toSeniorPhase(senior);

    const res = await uc.execute('s1', input('ya revisé la bujía y está bien'));
    expect(res.source).toBe('claude');
    expect(res.text).toBe('senior reply #2');

    const secondCall = senior.calls[1] ?? [];
    expect(secondCall).toHaveLength(3); // brief + first reply + new user turn
    expect(secondCall[2]?.content).toBe('ya revisé la bujía y está bien');
  });

  it('a mid-conversation senior failure falls back to the junior for that turn', async () => {
    const senior = fakeSenior();
    const uc = await toSeniorPhase(senior);

    senior.failNext.value = true;
    const res = await uc.execute('s1', input('y ahora?'));
    expect(res.source).toBe('carpsy');
    expect(res.text).toBe('junior reply');

    // Recovers on the next turn
    senior.failNext.value = false;
    const res2 = await uc.execute('s1', input('volvió el wifi'));
    expect(res2.source).toBe('claude');
  });

  it('every turn lands in the case log (user, junior interview + diagnosis, senior)', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = await toSeniorPhase(senior, log);
    await uc.execute('s1', input('gracias'));

    const roles = log.turns.map((t) => t.role);
    expect(roles).toEqual([
      'user', 'junior',   // symptom probe
      'user', 'junior',   // conditions question
      'user', 'junior',   // local diagnosis
      'user', 'senior',   // opt-in marker + senior reply
      'user', 'senior',   // follow-up
    ]);
  });
});

describe('interviewer (optional LLM question phrasing over the briefing)', () => {
  it('uses the LLM question when it passes the sanity floor', async () => {
    const interviewer: InterviewerPort = {
      phraseQuestion: async () => '¿Qué marca, modelo y año es tu vehículo?',
    };
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), fakeSenior(), fakeLog(), interviewer);
    const res = await uc.execute('s1', input('no arranca', { troubleCodes: [dtc('P0335')] }));
    expect(res.text).toBe('¿Qué marca, modelo y año es tu vehículo?');
  });

  it('the briefing block carries the case file and the objective', async () => {
    let received = '';
    const interviewer: InterviewerPort = {
      phraseQuestion: async (briefing) => { received = briefing; return '¿Y el año del vehículo?'; },
    };
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), fakeSenior(), fakeLog(), interviewer);
    await uc.execute('s1', input('mi auto no arranca', { troubleCodes: [dtc('P0335')] }));

    expect(received).toContain('CASE FILE');
    expect(received).toContain('P0335');
    expect(received).toContain('Engine does not start'); // confirmed symptom visible
    expect(received).toContain('Owner language: Spanish');
    expect(received).toContain('OBJECTIVE');
  });

  it('non-question LLM output is cataloged as junior hypothesis and the template ships', async () => {
    const interviewer: InterviewerPort = {
      phraseQuestion: async () => 'Puede ser la bomba de nafta, es una falla comun en ese modelo.',
    };
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), fakeSenior(), log, interviewer);
    const res = await uc.execute('s1', input('no arranca', { troubleCodes: [dtc('P0335')] }));

    expect(res.text).toContain('marca, modelo, año'); // template, not the diagnosis
    const hypothesis = log.turns.find((t) => t.content.startsWith('[hypothesis'));
    expect(hypothesis?.content).toContain('bomba de nafta'); // cataloged, not lost
  });

  it('falls back to the template when the LLM fails', async () => {
    const throwing: InterviewerPort = {
      phraseQuestion: async () => { throw new Error('model not loaded'); },
    };
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), fakeSenior(), fakeLog(), throwing);
    const res = await uc.execute('s1', input('no arranca', { troubleCodes: [dtc('P0335')] }));
    expect(res.text).toContain('marca, modelo, año');
  });
});

describe('deterministic gate on diagnosis turns (PLAN-002 v2 N2)', () => {
  const codes = [dtc('P0335')]; // crank sensor — closure: sensor_crank/sensors_engine/powertrain

  // Walks the full interview so fase 2 (junior diagnosis) fires.
  async function runInterview(uc: DiagnosticIntakeSessionUseCase) {
    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    return uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));
  }

  it('junior diagnosis citing an invented DTC + foreign domain ships UNCONFIRMED', async () => {
    const junior = fakeJunior('The P0999 code proves the catalytic converter failed.');
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), log);

    const res = await runInterview(uc);
    expect(res.gate?.passed).toBe(false);
    const rules = res.gate?.violations.map((v) => v.rule) ?? [];
    expect(rules).toContain('G2'); // P0999 is not an active code
    expect(rules).toContain('G1'); // catalyst is incoherent with a crank-sensor DTC

    // The verdict persists with the junior diagnosis turn (N2b)
    const gated = log.turns.filter((t) => t.role === 'junior' && t.gate != null);
    expect(gated).toHaveLength(1);
    expect(gated[0]?.gate?.passed).toBe(false);
  });

  it('a grounded junior diagnosis passes the gate', async () => {
    const junior = fakeJunior('P0335 indicates a faulty crankshaft position sensor; check its wiring.');
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), fakeLog());

    const res = await runInterview(uc);
    expect(res.gate?.passed).toBe(true);
    expect(res.gate?.violations).toEqual([]);
    expect(res.gate?.citedDtcs).toEqual(['P0335']);
  });

  it("the senior's first reply is gated and the verdict persists with the turn", async () => {
    const senior = fakeSenior(true, 'Replace the catalytic converter and clear the codes.');
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);

    await runInterview(uc);
    const res = await uc.requestSenior('s1', input('', { troubleCodes: codes }));
    expect(res.source).toBe('claude');
    expect(res.gate?.passed).toBe(false); // catalyst ⊄ closure(P0335)

    const gated = log.turns.filter((t) => t.role === 'senior' && t.gate != null);
    expect(gated).toHaveLength(1);
    expect(gated[0]?.gate?.passed).toBe(false);
  });

  it('intake questions and follow-up chatter carry NO gate verdict', async () => {
    const junior = fakeJunior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), log);

    const q1 = await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    expect(q1.gate).toBeUndefined(); // ladder question, not a diagnosis

    await runInterview(uc);
    // Follow-up local chat after the diagnosis (awaiting_senior phase)
    const followUp = await uc.execute('s1', input('gracias, ¿algo más?', { troubleCodes: codes }));
    expect(followUp.gate).toBeUndefined();

    // Exactly ONE gated turn in the whole log: the junior diagnosis
    expect(log.turns.filter((t) => t.gate != null)).toHaveLength(1);
  });
});

describe('harvest admission valve (PLAN-002 v2 C1)', () => {
  const codes = [dtc('P0335')];

  function fakeHarvest() {
    const cases: { brief: unknown; seniorAnswer: string; gate: { passed: boolean } }[] = [];
    return {
      cases,
      contributeCase(c: { brief: unknown; seniorAnswer: string; gate: { passed: boolean } }) {
        cases.push(c);
      },
    };
  }

  async function runToSenior(uc: DiagnosticIntakeSessionUseCase) {
    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    await uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));
    return uc.requestSenior('s1', input('', { troubleCodes: codes }));
  }

  it('a gate-passed senior diagnosis is contributed exactly once', async () => {
    const harvest = fakeHarvest();
    const senior = fakeSenior(true, 'P0335 points to the crankshaft position sensor; test its wiring first.');
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog(), null, harvest);

    const res = await runToSenior(uc);
    expect(res.gate?.passed).toBe(true);
    expect(harvest.cases).toHaveLength(1);
    expect(harvest.cases[0]?.seniorAnswer).toContain('crankshaft');
    expect(harvest.cases[0]?.gate.passed).toBe(true);
  });

  it('a gate-failed senior diagnosis is NOT contributed (valve holds)', async () => {
    const harvest = fakeHarvest();
    const senior = fakeSenior(true, 'Replace the catalytic converter and clear the codes.');
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog(), null, harvest);

    const res = await runToSenior(uc);
    expect(res.gate?.passed).toBe(false);
    expect(harvest.cases).toHaveLength(0);
  });

  it('junior diagnoses never reach the harvest — even when they pass the gate', async () => {
    const harvest = fakeHarvest();
    const junior = fakeJunior('P0335 indicates a faulty crankshaft position sensor.');
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), fakeLog(), null, harvest);

    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    const res = await uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));
    expect(res.gate?.passed).toBe(true);  // junior passed…
    expect(harvest.cases).toHaveLength(0); // …but only senior cases distill
  });
});

describe('senior return path — offline reuse (PLAN-002 v2 N3a)', () => {
  const codes = [dtc('P0335')];

  function fakeKnowledgeReturn() {
    const stored: { query: string; answer: string }[] = [];
    return {
      stored,
      storeSeniorAnswer(query: string, answer: string) { stored.push({ query, answer }); },
    };
  }

  async function runToSenior(uc: DiagnosticIntakeSessionUseCase) {
    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    await uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));
    return uc.requestSenior('s1', input('', { troubleCodes: codes }));
  }

  it('stores a gate-passed senior diagnosis with a case retrieval key', async () => {
    const kr = fakeKnowledgeReturn();
    const senior = fakeSenior(true, 'P0335 points to the crankshaft position sensor; test its wiring.');
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog(), null, null, kr);

    const res = await runToSenior(uc);
    expect(res.gate?.passed).toBe(true);
    expect(kr.stored).toHaveLength(1);
    expect(kr.stored[0]?.answer).toContain('crankshaft');
    // The key carries the case essence (DTC + vehicle), never a VIN.
    expect(kr.stored[0]?.query).toContain('P0335');
    expect(kr.stored[0]?.query).toContain('Chevrolet');
    expect(kr.stored[0]?.query).not.toContain('3G1SF'); // no VIN
  });

  it('does NOT store a gate-failed senior diagnosis (same admission valve)', async () => {
    const kr = fakeKnowledgeReturn();
    const senior = fakeSenior(true, 'Replace the catalytic converter and clear the codes.');
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog(), null, null, kr);

    const res = await runToSenior(uc);
    expect(res.gate?.passed).toBe(false);
    expect(kr.stored).toHaveLength(0);
  });
});
