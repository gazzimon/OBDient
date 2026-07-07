// Tests for symptom-matcher.ts — deterministic keyword → SymptomId mapping.

import { matchSymptoms } from '@/domain/services/symptom-matcher';

describe('matchSymptoms', () => {
  const CASES: ReadonlyArray<[string, string[]]> = [
    ['el auto no arranca', ['sym_no_start']],
    ['tira humo azul y quema aceite', ['sym_smoke_blue']],
    ['tiembla en ralenti y el check engine titila', ['sym_rough_idle', 'sym_cel_flashing']],
    ['huele a nafta adentro', ['sym_smell_fuel']],
    ['se calienta mucho y pierde agua', ['sym_coolant_leak', 'sym_overheating']],
    ['the engine stalls and I smell rotten egg', ['sym_stall', 'sym_smell_sulfur']],
    ['consume mucho combustible ultimamente', ['sym_high_consumption']],
    ['anda perfecto', []],
    ['', []],
  ];

  it.each(CASES)('"%s" → %j', (text, expected) => {
    expect(matchSymptoms(text).sort()).toEqual([...expected].sort());
  });

  it('is accent- and case-insensitive', () => {
    expect(matchSymptoms('TIEMBLA EN RALENTÍ')).toContain('sym_rough_idle');
    expect(matchSymptoms('pérdida de aceite')).toContain('sym_oil_leak');
  });

  it('does not fire overheating on "no calienta" (warm-up complaint)', () => {
    const matched = matchSymptoms('el motor no calienta nunca');
    expect(matched).toContain('sym_no_warmup');
    expect(matched).not.toContain('sym_overheating');
  });

  it('is deterministic', () => {
    const text = 'no arranca y tira humo negro';
    expect(matchSymptoms(text)).toEqual(matchSymptoms(text));
  });
});
