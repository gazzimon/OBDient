// Table tests for the deterministic anti-hallucination gate (PLAN-002 v2, N1).
// Pure logic: every rule gets pass / violation / inert cases.

import { runGate, GateContext } from '@/domain/services/diagnostic-gate';
import type { VehicleState } from '@/domain/entities/diagnostic-context';

function state(over: Partial<VehicleState> = {}): VehicleState {
  return {
    engineState: 'running',
    aggregateSeverity: 'warning',
    activeAlerts: [],
    presentPids: [],
    readinessComplete: false,
    hasFreezeFrame: false,
    ...over,
  };
}

function ctx(codes: string[], over: Partial<VehicleState> = {}): GateContext {
  return { dtcs: codes.map((code) => ({ code })), state: state(over) };
}

function rules(result: ReturnType<typeof runGate>): string[] {
  return result.violations.map((v) => v.rule);
}

describe('G2 — cited DTCs must exist', () => {
  it('passes when the cited DTC is active', () => {
    const r = runGate('Your P0420 indicates catalyst efficiency below threshold.', ctx(['P0420']));
    expect(r.passed).toBe(true);
    expect(r.citedDtcs).toEqual(['P0420']);
    expect(rules(r)).not.toContain('G2');
  });

  it('rejects a DTC the vehicle never reported (invented signal)', () => {
    const r = runGate('The P0455 EVAP leak is the root cause here.', ctx(['P0300']));
    expect(r.passed).toBe(false);
    expect(r.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'G2', weight: 'hard' })]),
    );
  });

  it('matches case-insensitively and dedupes', () => {
    const r = runGate('el código p0300 (P0300) apareció', ctx(['P0300']));
    expect(r.citedDtcs).toEqual(['P0300']);
    expect(rules(r)).not.toContain('G2');
  });

  it('flags each distinct invented code once', () => {
    const r = runGate('Could be P0171 or P0455.', ctx(['P0300']));
    expect(r.violations.filter((v) => v.rule === 'G2')).toHaveLength(2);
  });
});

describe('G1 — fault-domain coherence via SKOS closure', () => {
  it('passes: catalyst claim with a catalyst DTC active', () => {
    const r = runGate('The catalytic converter is degraded.', ctx(['P0420']));
    expect(rules(r)).not.toContain('G1');
    expect(r.mentionedConcepts).toContain('catalyst');
  });

  it('rejects: catalyst claim with only a lean-mixture DTC (PLAN-001 example)', () => {
    const r = runGate('You should replace the catalytic converter.', ctx(['P0171']));
    expect(r.passed).toBe(false);
    expect(r.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'G1', weight: 'hard' })]),
    );
  });

  it('passes: injector claim with a cylinder-misfire DTC (via SKOS related edge)', () => {
    // P0302 → misfire_cylinder, whose related includes fuel_injectors.
    const r = runGate('Check the fuel injector on cylinder 2.', ctx(['P0302']));
    expect(rules(r)).not.toContain('G1');
  });

  it('passes: misfire wording with P0300', () => {
    const r = runGate('Random misfire across cylinders; check spark plugs.', ctx(['P0300']));
    expect(rules(r)).not.toContain('G1');
  });

  it('is inert without active DTCs (hypotheses are allowed)', () => {
    const r = runGate('Podría ser el catalizador o los inyectores.', ctx([]));
    expect(rules(r)).not.toContain('G1');
    expect(r.passed).toBe(true);
  });

  it('is inert when any active DTC is unmapped (never accuse from ignorance)', () => {
    // P1234 is a manufacturer code outside the ontology → unknown domain.
    const r = runGate('The fuel pump may be failing.', ctx(['P0420', 'P1234']));
    expect(rules(r)).not.toContain('G1');
  });

  it('works on Spanish component mentions', () => {
    const r = runGate('El catalizador está dañado y debe reemplazarse.', ctx(['P0171']));
    expect(rules(r)).toContain('G1');
  });
});

describe('G5 — engine-state coherence', () => {
  it('rejects a no-start claim while live RPM shows the engine running', () => {
    const r = runGate("The engine won't start due to a dead crank sensor.", ctx(['P0335']));
    expect(r.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'G5', weight: 'hard' })]),
    );
  });

  it('allows the claim when the engine truly is not starting', () => {
    const r = runGate('El motor no arranca; revisá el sensor de cigüeñal.', ctx(['P0335'], { engineState: 'no_start' }));
    expect(rules(r)).not.toContain('G5');
  });

  it('is inert when engine state is unknown (no RPM evidence)', () => {
    const r = runGate("It won't start.", ctx(['P0335'], { engineState: 'unknown' }));
    expect(rules(r)).not.toContain('G5');
  });
});

describe('G3 (soft) — urgency coherence', () => {
  it('annotates do-not-drive urgency when nothing justifies it', () => {
    const r = runGate('Do not drive the vehicle until repaired.', ctx(['P0456'], { aggregateSeverity: 'info' }));
    expect(r.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'G3', weight: 'soft' })]),
    );
    // Soft violations never block: the answer still passes.
    expect(r.passed).toBe(true);
  });

  it('allows urgency with a critical DTC', () => {
    const r = runGate('Stop driving immediately.', ctx(['P0016'], { aggregateSeverity: 'critical' }));
    expect(rules(r)).not.toContain('G3');
  });

  it('allows urgency when a critical live alert exists', () => {
    const r = runGate('No conduzca el vehículo.', ctx([], {
      aggregateSeverity: 'none',
      activeAlerts: [{ pid: 'COOLANT_TEMP', severity: 'critical', message: 'Overheating' }],
    }));
    expect(rules(r)).not.toContain('G3');
  });
});

describe('verdict semantics', () => {
  it('a clean grounded answer passes with empty violations', () => {
    const r = runGate(
      'P0420 means catalyst efficiency below threshold. Check the oxygen sensor readings first.',
      ctx(['P0420']),
    );
    expect(r).toMatchObject({ passed: true, violations: [] });
  });

  it('accumulates violations across rules', () => {
    const r = runGate(
      "The P0999 code shows the catalytic converter failed — the engine won't start.",
      ctx(['P0171']),
    );
    const ids = rules(r);
    expect(ids).toEqual(expect.arrayContaining(['G2', 'G1', 'G5']));
    expect(r.passed).toBe(false);
  });
});
