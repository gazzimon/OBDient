// Tests for symptom-matcher.ts — deterministic keyword → SymptomId mapping.

import { matchSymptoms, matchSymptomsDetailed } from '@/domain/services/symptom-matcher';

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

describe('matchSymptomsDetailed — negation (denied symptoms)', () => {
  it('a negator before the keyword flips it to denied', () => {
    const result = matchSymptomsDetailed('no tira humo blanco');
    expect(result.denied).toContain('sym_smoke_white');
    expect(result.confirmed).not.toContain('sym_smoke_white');
  });

  it('mixes confirmed and denied in one sentence', () => {
    const result = matchSymptomsDetailed('tiembla en ralenti pero no tira humo azul');
    expect(result.confirmed).toContain('sym_rough_idle');
    expect(result.denied).toContain('sym_smoke_blue');
  });

  it('"no arranca" stays confirmed — the negation is part of the symptom itself', () => {
    const result = matchSymptomsDetailed('el auto no arranca');
    expect(result.confirmed).toContain('sym_no_start');
    expect(result.denied).toHaveLength(0);
  });

  it('a sentence break cancels the negation', () => {
    const result = matchSymptomsDetailed('humo no. tira humo negro');
    expect(result.confirmed).toContain('sym_smoke_black');
  });

  it('english negation works too', () => {
    const result = matchSymptomsDetailed("it doesn't have white smoke");
    expect(result.denied).toContain('sym_smoke_white');
  });
});
