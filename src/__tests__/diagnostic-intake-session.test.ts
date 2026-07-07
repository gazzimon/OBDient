// Tests for the ADR-0009 session state machine, intake v2:
// ladder interview (identity → OBD → symptoms → senses → conditions),
// "catalog never discard" (user-described + denied symptoms), bilingual
// template fallback, and honest degradation at every failure point.
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

function fakeJunior(): JuniorChatPort & { calls: ChatWithQVACInput[] } {
  const calls: ChatWithQVACInput[] = [];
  return {
    calls,
    async execute(i: ChatWithQVACInput): Promise<MultiAgentChatResult> {
      calls.push(i);
      return { text: 'junior reply', generatedAt: new Date(), isAiGenerated: true, source: 'carpsy' };
    },
  };
}

function fakeSenior(configured = true): SeniorAgentPort & {
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
      return `senior reply #${calls.length}`;
    },
  };
}

function fakeLog(): CaseLogPort & {
  turns: { role: string; content: string }[];
  briefs: { prompt: string }[];
  candidates: string[];
} {
  const turns: { role: string; content: string }[] = [];
  const briefs: { prompt: string }[] = [];
  const candidates: string[] = [];
  return {
    turns,
    briefs,
    candidates,
    logTurn: (_s, role, content) => { turns.push({ role, content }); },
    logBrief: (_s, _b, prompt) => { briefs.push({ prompt }); },
    logSymptomCandidate: (_s, description) => { candidates.push(description); },
  };
}

const fullCase = (text: string, codes: TroubleCode[] = [dtc('P0302')]) =>
  input(text, { vehicle: vehicle(), troubleCodes: codes, parameters: { RPM: param('RPM', 850) } });

describe('intake phase — ladder', () => {
  it('passes general chat through to the junior without starting a case', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());

    const res = await uc.execute('s1', input('hola, como estas?'));
    expect(res.text).toBe('junior reply');
    expect(junior.calls).toHaveLength(1);
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

  it('full interview: identity → conditions → handoff with the enriched brief', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);
    const codes = [dtc('P0335')];

    // Symptom arrives in msg 1 ("no arranca"); identity is asked
    await uc.execute('s1', input('no arranca', { troubleCodes: codes }));
    // Identity answered (mileage + fuel included) → conditions question
    const q2 = await uc.execute('s1', input('es un chevrolet corsa 2008 1.6 nafta, 150 mil km', { troubleCodes: codes }));
    expect(q2.source).toBe('carpsy');
    expect(q2.text).toContain('desde cuándo');
    // Conditions answered → the ONE senior call
    const res = await uc.execute('s1', input('desde hace una semana, en frio', { troubleCodes: codes }));
    expect(res.source).toBe('claude');
    expect(senior.calls).toHaveLength(1);

    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('Chevrolet Corsa 2008');
    expect(prompt).toContain('petrol');
    expect(prompt).toContain('Odometer: 150000 km');
    expect(prompt).toContain('P0335');
    expect(prompt).toContain('Engine does not start');
    expect(prompt).toContain('desde hace una semana'); // interview answers travel
    expect(log.briefs).toHaveLength(1);
  });

  it('VIN + DTCs still get interviewed: symptom probe (hinted) then conditions', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    const q1 = await uc.execute('s1', fullCase('diagnose my codes'));
    expect(senior.calls).toHaveLength(0);
    expect(q1.text).toContain('Rough / shaky idle'); // hint from P0302's fault class

    const q2 = await uc.execute('s1', fullCase('tiembla en ralenti y titila el check'));
    expect(q2.text).toContain('desde cuándo'); // language followed the owner

    const res = await uc.execute('s1', fullCase('desde ayer, en frio'));
    expect(res.source).toBe('claude');
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
    expect(res.source).toBe('claude');
  });

  it('catalogs substantive descriptions that match no taxonomy entry (never discards)', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);

    await uc.execute('s1', fullCase('diagnose my codes'));            // symptom probe
    await uc.execute('s1', fullCase('se sacude al acelerar en subida')); // no keyword match
    expect(log.candidates).toEqual(['se sacude al acelerar en subida']);

    const res = await uc.execute('s1', fullCase('desde ayer'));       // conditions answered
    expect(res.source).toBe('claude');
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('se sacude al acelerar en subida'); // user-described travels
  });

  it('denied symptoms become negative evidence in the brief', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    await uc.execute('s1', fullCase('tiembla en ralenti pero no tira humo azul'));
    const res = await uc.execute('s1', fullCase('desde hace un mes, siempre'));
    expect(res.source).toBe('claude');
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt).toContain('DENIED');
    expect(prompt).toContain('Blue smoke');
  });

  it('an owner who cannot describe symptoms exhausts both probes, then the senior gets the case', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());
    const vague = () => fullCase('anda raro pero no se explicar');

    const q1 = await uc.execute('s1', vague()); // open symptoms probe
    const q2 = await uc.execute('s1', vague()); // senses probe
    expect(q1.source).toBe('carpsy');
    expect(q2.source).toBe('carpsy');
    const res = await uc.execute('s1', vague()); // probes exhausted, G0 holds
    expect(res.source).toBe('claude');
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

    expect(senior.calls).toHaveLength(1);
    const prompt = senior.calls[0]?.[0]?.content ?? '';
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toContain('3G1SF21649S123456');
  });

  it('degrades to the junior when the senior is not configured (no pointless interview)', async () => {
    const junior = fakeJunior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(false), fakeLog());

    const res = await uc.execute('s1', fullCase('diagnose'));
    expect(res.source).toBe('carpsy');
    expect(junior.calls).toHaveLength(1);
  });
});

describe('senior phase', () => {
  async function toSeniorPhase(senior: ReturnType<typeof fakeSenior>, log = fakeLog()) {
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);
    await uc.execute('s1', fullCase('diagnose'));                 // → symptom probe
    await uc.execute('s1', fullCase('tiembla en ralenti'));       // → conditions
    await uc.execute('s1', fullCase('desde ayer, en frio'));      // → handoff
    return uc;
  }

  it('after handoff the senior conducts the conversation with full history', async () => {
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

  it('every turn lands in the case log (user, junior interview, senior)', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = await toSeniorPhase(senior, log);
    await uc.execute('s1', input('gracias'));

    const roles = log.turns.map((t) => t.role);
    expect(roles).toEqual(['user', 'junior', 'user', 'junior', 'user', 'senior', 'user', 'senior']);
  });
});

describe('interviewer (LLM question phrasing over the briefing)', () => {
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
