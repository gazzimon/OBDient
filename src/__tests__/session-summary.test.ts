import { buildSessionSummary, SUMMARY_MAX } from '@/domain/services/session-summary';
import { createSession } from '@/domain/entities/diagnostic-session';
import { createTroubleCode } from '@/domain/entities/trouble-code';
import { createChatMessage } from '@/domain/entities/chat-message';
import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';
import type { TroubleCode } from '@/domain/entities/trouble-code';

function dtc(code: string): TroubleCode {
  return createTroubleCode(code, 'P', `${code} description`, 'warning');
}

function sessionOf(opts: {
  dtcs?: TroubleCode[];
  userMsgs?: string[];
}): DiagnosticSession {
  return {
    ...createSession('veh-1'),
    troubleCodes: opts.dtcs ?? [],
    messages: (opts.userMsgs ?? []).map((c) => createChatMessage('user', c)),
  };
}

describe('buildSessionSummary', () => {
  it('joins "DTC · symptom" when both fit within the limit', () => {
    const s = sessionOf({ dtcs: [dtc('P0300')], userMsgs: ['el auto tiembla en ralenti'] });
    // "P0300 · Rough / shaky idle" = 26 chars
    expect(buildSessionSummary(s)).toBe('P0300 · Rough / shaky idle');
  });

  it('keeps the DTC code intact and drops the symptom when the pair overflows', () => {
    // sym_hesitation label "Hesitation / stumble on acceleration" is 36 chars →
    // pair overflows, so only the code ships (never a mid-word symptom cut).
    const s = sessionOf({ dtcs: [dtc('P0301')], userMsgs: ['tironea al acelerar'] });
    expect(buildSessionSummary(s)).toBe('P0301');
  });

  it('collapses several DTCs to "primary +N"', () => {
    const s = sessionOf({ dtcs: [dtc('P0300'), dtc('P0171'), dtc('P0420')], userMsgs: ['hola'] });
    expect(buildSessionSummary(s)).toBe('P0300 +2');
  });

  it('uses the matched symptom label alone when there is no DTC', () => {
    const s = sessionOf({ userMsgs: ['sale humo blanco por el escape'] });
    expect(buildSessionSummary(s)).toBe('White smoke from exhaust');
  });

  it("falls back to the owner's first words when nothing matches", () => {
    const s = sessionOf({ userMsgs: ['quiero que revises una cosa rara del auto por favor'] });
    const out = buildSessionSummary(s);
    expect(out.startsWith('quiero que revises')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns a dash for an empty session', () => {
    expect(buildSessionSummary(sessionOf({}))).toBe('—');
  });

  it('never exceeds SUMMARY_MAX characters', () => {
    const cases: DiagnosticSession[] = [
      sessionOf({ dtcs: [dtc('P0300')], userMsgs: ['tiembla en ralenti'] }),
      sessionOf({ dtcs: [dtc('P0301')], userMsgs: ['tironea al acelerar'] }),
      sessionOf({ userMsgs: ['a'.repeat(120)] }),
      sessionOf({ userMsgs: ['sale humo blanco'] }),
      sessionOf({}),
    ];
    for (const s of cases) {
      expect(buildSessionSummary(s).length).toBeLessThanOrEqual(SUMMARY_MAX);
    }
  });
});
