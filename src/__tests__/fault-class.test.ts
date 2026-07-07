// Tests for fault-class.ts — deterministic DTC → FaultClass (PLAN-002 M0).
// All functions are pure (no I/O, no side effects), so no mocks needed.

import {
  faultClassFor,
  faultClassClosure,
  isInFaultClassClosure,
} from '@/domain/services/fault-class';

// ---------------------------------------------------------------------------
// faultClassFor — canonical concept resolution
// ---------------------------------------------------------------------------

describe('faultClassFor — concept resolution', () => {
  it('resolves an exact ontology DTC', () => {
    const fc = faultClassFor('P0300');
    expect(fc.conceptId).toBe('misfire_random');
    expect(fc.label).toBe('Random / multiple cylinder misfire');
  });

  // The gap M0 closes: conceptForDtc('P0302') returns null because the
  // ontology stores the range id 'P0301-P0308' verbatim.
  it('resolves a concrete code inside an ontology range', () => {
    expect(faultClassFor('P0302').conceptId).toBe('misfire_cylinder');
  });

  // Table: one concrete member per ontology range
  const RANGE_CASES: ReadonlyArray<[string, string]> = [
    ['P0301', 'misfire_cylinder'],   // P0301-P0308
    ['P0308', 'misfire_cylinder'],   // range end is inclusive
    ['P0174', 'fuel_lean'],          // P0171-P0174
    ['P0175', 'fuel_rich'],          // P0172-P0175
    ['P0421', 'catalyst'],           // P0420-P0430
    ['P0455', 'evap'],               // P0442-P0455
    ['P0117', 'sensor_temperature'], // P0113-P0118
    ['P0140', 'sensor_o2'],          // P0130-P0167
    ['P0102', 'sensor_maf'],         // P0100-P0104
    ['P0336', 'sensor_crank'],       // P0335-P0338
    ['P0344', 'sensor_cam'],         // P0340-P0349
    ['P0330', 'sensor_knock'],       // P0325-P0334
    ['P0122', 'throttle'],           // P0120-P0124
    ['P0225', 'throttle'],           // P0221-P0229
  ];

  it.each(RANGE_CASES)('%s → %s', (dtc, conceptId) => {
    expect(faultClassFor(dtc).conceptId).toBe(conceptId);
  });

  it('prefers an exact ontology key over range membership', () => {
    // P0300 is an exact key; P0301-P0308 is the adjacent range
    expect(faultClassFor('P0300').conceptId).toBe('misfire_random');
    // P0128 is an exact key on sensor_temperature, outside its own range
    expect(faultClassFor('P0128').conceptId).toBe('sensor_temperature');
  });

  // KNOWN ONTOLOGY DATA BUG: 'P0171-P0174' (fuel_lean) and 'P0172-P0175'
  // (fuel_rich) are stored as ranges but SAE interleaves them (P0171/P0174 lean,
  // P0172/P0175 rich). Range order resolves P0172/P0173 to fuel_lean. The
  // parent closure (fuel_mixture → fuel_system → powertrain) is still correct,
  // so G1 is unaffected above leaf level. Fix belongs in obd-ontology.ts
  // (explicit code lists), deferred to avoid a behavior change in M0.
  it.failing('P0172 should resolve to fuel_rich (interleaved-range bug)', () => {
    expect(faultClassFor('P0172').conceptId).toBe('fuel_rich');
  });

  it('P0172 shares the correct parent closure despite the leaf ambiguity', () => {
    expect(isInFaultClassClosure('P0172', 'fuel_mixture')).toBe(true);
    expect(isInFaultClassClosure('P0172', 'fuel_system')).toBe(true);
  });

  it('still accepts a verbatim range id (conceptForDtc compatibility)', () => {
    expect(faultClassFor('P0301-P0308').conceptId).toBe('misfire_cylinder');
  });

  it('normalizes case and whitespace', () => {
    expect(faultClassFor(' p0302 ').conceptId).toBe('misfire_cylinder');
    expect(faultClassFor(' p0302 ').dtc).toBe('P0302');
  });

  it('returns a null concept for an unmapped DTC', () => {
    const fc = faultClassFor('P1601'); // manufacturer-specific, not in ontology
    expect(fc.conceptId).toBeNull();
    expect(fc.label).toBeNull();
  });

  it('returns a null concept for malformed input', () => {
    expect(faultClassFor('not-a-dtc').conceptId).toBeNull();
    expect(faultClassFor('').conceptId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// faultClassFor — severity (delegates to dtcParser.classifySeverity)
// ---------------------------------------------------------------------------

describe('faultClassFor — severity', () => {
  // Table mirrors the SAE J2012 range heuristics in dtcParser
  const SEVERITY_CASES: ReadonlyArray<[string, string]> = [
    ['P0302', 'critical'], // misfire range 0x0300-0x0399
    ['P0171', 'critical'], // fuel/air metering 0x0100-0x0199
    ['P0A00', 'critical'], // control module 0x0A00-0x0AFF
    ['P0420', 'warning'],  // catalyst — P0 generic outside critical ranges
    ['P0500', 'warning'],
    ['B1000', 'info'],     // body
    ['C1234', 'info'],     // chassis
    ['U0100', 'info'],     // network
  ];

  it.each(SEVERITY_CASES)('%s → %s', (dtc, severity) => {
    expect(faultClassFor(dtc).severity).toBe(severity);
  });

  it('unmapped codes still get a severity (graceful degradation)', () => {
    expect(faultClassFor('P1601').severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// faultClassClosure
// ---------------------------------------------------------------------------

describe('faultClassClosure', () => {
  it('returns canonical concept first, then ancestors up to the root', () => {
    const ids = faultClassClosure('P0302').map((c) => c.id);
    expect(ids).toEqual(['misfire_cylinder', 'ignition', 'powertrain']);
  });

  it('does not include SKOS related concepts (closure is subClassOf only)', () => {
    const ids = faultClassClosure('P0420').map((c) => c.id);
    expect(ids).toEqual(['catalyst', 'emissions', 'powertrain']);
    // catalyst.related includes misfire_random — must NOT leak into the closure
    expect(ids).not.toContain('misfire_random');
  });

  it('returns an empty closure for an unmapped DTC', () => {
    expect(faultClassClosure('P1601')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isInFaultClassClosure — G1 primitive
// ---------------------------------------------------------------------------

describe('isInFaultClassClosure', () => {
  it('accepts the canonical concept and every ancestor', () => {
    expect(isInFaultClassClosure('P0420', 'catalyst')).toBe(true);
    expect(isInFaultClassClosure('P0420', 'emissions')).toBe(true);
    expect(isInFaultClassClosure('P0420', 'powertrain')).toBe(true);
  });

  it('rejects a concept outside the closure (G1 rejection case)', () => {
    // Hypothesis blames the ignition system but the only DTC is a catalyst code
    expect(isInFaultClassClosure('P0420', 'ignition')).toBe(false);
    expect(isInFaultClassClosure('P0420', 'misfire_random')).toBe(false);
  });

  it('rejects everything for an unmapped DTC', () => {
    expect(isInFaultClassClosure('P1601', 'powertrain')).toBe(false);
  });
});
