// Tests for the ADR-0009 session state machine: intake → handoff → senior,
// with honest degradation to the local junior at every failure point.
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
} {
  const turns: { role: string; content: string }[] = [];
  const briefs: { prompt: string }[] = [];
  return {
    turns,
    briefs,
    logTurn: (_s, role, content) => { turns.push({ role, content }); },
    logBrief: (_s, _b, prompt) => { briefs.push({ prompt }); },
  };
}

describe('intake phase', () => {
  it('passes general chat through to the junior without starting a case', async () => {
    const junior = fakeJunior();
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, senior, fakeLog());

    const res = await uc.execute('s1', input('hola, como estas?'));
    expect(res.text).toBe('junior reply');
    expect(junior.calls).toHaveLength(1);
    expect(senior.calls).toHaveLength(0);
  });

  it('a diagnostic message without identity triggers an intake question, not a diagnosis', async () => {
    const junior = fakeJunior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), log);

    const res = await uc.execute('s1', input('mi auto no arranca', { troubleCodes: [dtc('P0335')] }));
    expect(res.source).toBe('carpsy');
    expect(res.text).toContain('make, model and year');
    expect(junior.calls).toHaveLength(0); // no junior diagnosis — intake owns the turn
    expect(log.turns.map((t) => t.role)).toEqual(['user', 'junior']);
  });

  it('hands off after identity is provided: ONE senior call fed with the brief', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);

    await uc.execute('s1', input('no arranca', { troubleCodes: [dtc('P0335')] }));
    const res = await uc.execute('s1', input('es un chevrolet corsa 2008 1.6', { troubleCodes: [dtc('P0335')] }));

    expect(res.source).toBe('claude');
    expect(res.text).toBe('senior reply #1');
    expect(senior.calls).toHaveLength(1);

    const briefPrompt = senior.calls[0]?.[0]?.content ?? '';
    expect(briefPrompt).toContain('Chevrolet Corsa 2008');
    expect(briefPrompt).toContain('P0335');
    expect(briefPrompt).toContain('Engine does not start'); // symptom captured from "no arranca"
    expect(log.briefs).toHaveLength(1);
  });

  it('handoff waits for OBD evidence even with full identity (one GOOD call)', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    const res = await uc.execute('s1', input('mi chevrolet corsa 2008 tira humo azul'));
    expect(senior.calls).toHaveLength(0);
    expect(res.text).toContain('no OBD data yet');
  });

  it('VIN-decoded vehicle + DTCs = immediate handoff on the first diagnostic message', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    const res = await uc.execute('s1', input('diagnose my codes', {
      vehicle: vehicle(),
      troubleCodes: [dtc('P0302')],
      parameters: { RPM: param('RPM', 850) },
    }));
    expect(res.source).toBe('claude');
    expect(senior.calls).toHaveLength(1);
  });

  it('the brief prompt sent to the senior never contains the VIN', async () => {
    const senior = fakeSenior();
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, fakeLog());

    await uc.execute('s1', input('mi vin es 3G1SF21649S123456, revisa los codigos', {
      vehicle: vehicle(),
      troubleCodes: [dtc('P0302')],
    }));
    expect(senior.calls[0]?.[0]?.content).not.toContain('3G1SF21649S123456');
  });

  it('gives up interviewing after the question cap and lets the junior work', async () => {
    const junior = fakeJunior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(), fakeLog());

    // 4 unhelpful replies consume the cap, the 5th goes to the junior
    for (let i = 0; i < 4; i++) {
      const res = await uc.execute('s1', input('no se que auto es', { troubleCodes: [dtc('P0300')] }));
      expect(res.text).toContain('?');
    }
    const res = await uc.execute('s1', input('sigue fallando', { troubleCodes: [dtc('P0300')] }));
    expect(res.text).toBe('junior reply');
    expect(junior.calls).toHaveLength(1);
  });

  it('degrades to the junior when the senior is not configured', async () => {
    const junior = fakeJunior();
    const uc = new DiagnosticIntakeSessionUseCase(junior, fakeSenior(false), fakeLog());

    const res = await uc.execute('s1', input('diagnose', {
      vehicle: vehicle(),
      troubleCodes: [dtc('P0302')],
    }));
    expect(res.source).toBe('carpsy');
    expect(junior.calls).toHaveLength(1);
  });
});

describe('senior phase', () => {
  async function toSeniorPhase(senior: ReturnType<typeof fakeSenior>, log = fakeLog()) {
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), senior, log);
    await uc.execute('s1', input('diagnose', {
      vehicle: vehicle(),
      troubleCodes: [dtc('P0302')],
    }));
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

  it('every turn lands in the case log (user, senior)', async () => {
    const senior = fakeSenior();
    const log = fakeLog();
    const uc = await toSeniorPhase(senior, log);
    await uc.execute('s1', input('gracias'));

    const roles = log.turns.map((t) => t.role);
    expect(roles).toEqual(['user', 'senior', 'user', 'senior']);
  });
});

describe('interviewer (LLM question phrasing)', () => {
  const intakeInput = () => input('no arranca', { troubleCodes: [dtc('P0335')] });

  it('uses the LLM question when it passes the sanity floor', async () => {
    const interviewer: InterviewerPort = {
      phraseQuestion: async () => '¿Qué marca, modelo y año es tu vehículo?',
    };
    const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), fakeSenior(), fakeLog(), interviewer);
    const res = await uc.execute('s1', intakeInput());
    expect(res.text).toBe('¿Qué marca, modelo y año es tu vehículo?');
  });

  it('falls back to the template when the LLM output is garbage or fails', async () => {
    const garbage: InterviewerPort = { phraseQuestion: async () => 'ok' };
    const throwing: InterviewerPort = { phraseQuestion: async () => { throw new Error('model not loaded'); } };

    for (const interviewer of [garbage, throwing]) {
      const uc = new DiagnosticIntakeSessionUseCase(fakeJunior(), fakeSenior(), fakeLog(), interviewer);
      const res = await uc.execute('s1', intakeInput());
      expect(res.text).toContain('make, model and year');
    }
  });
});
