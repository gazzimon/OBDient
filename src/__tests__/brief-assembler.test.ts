// Tests for brief-assembler.ts — deterministic handoff brief (ADR-0009 §2)
// and the G0 readiness checklist (§1).

import { buildBrief, briefReadiness, renderBriefPrompt, BriefInput } from '@/domain/services/brief-assembler';
import { redactText, REDACTED } from '@/core/utils/redact';
import type { Vehicle } from '@/domain/entities/vehicle';
import type { ObdParameter, ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { PidId, AlertSeverity } from '@/core/constants/pids';
import { PID_DEFINITIONS } from '@/core/constants/pids';
import type { DtcSeverity } from '@/core/utils/dtcParser';

const T0 = new Date('2026-07-01T12:00:00Z');
const NOW = T0.getTime();

function param(
  pid: PidId,
  value: number,
  alert: { severity: AlertSeverity; message: string } | null = null,
): ObdParameter {
  const def = PID_DEFINITIONS[pid];
  return { pid, name: def.name, value, unit: def.unit, timestamp: T0, alert };
}

function dtc(code: string, severity: DtcSeverity, description = `test ${code}`): TroubleCode {
  return { id: `${code}-test`, code, system: 'P', description, severity, detectedAt: T0, interpretation: null };
}

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v-test',
    make: 'Chevrolet',
    model: 'Corsa',
    year: 2008,
    vin: '3G1SF21649S123456',
    manufacturer: 'GM',
    plantCountry: 'AR',
    protocol: 'AUTO',
    adapterAddress: '00:11:22:33',
    connectedAt: T0,
    ...overrides,
  };
}

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    vehicle: null,
    userIdentity: null,
    mileageKm: null,
    troubleCodes: [],
    parameters: {},
    symptomIds: [],
    userNotes: null,
    now: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Identity resolution (VIN > user > unknown)
// ---------------------------------------------------------------------------

describe('buildBrief — identity precedence', () => {
  it('uses the decoded vehicle when available (source: vin)', () => {
    const brief = buildBrief(input({ vehicle: vehicle() }));
    expect(brief.identity).toEqual({
      make: 'Chevrolet', model: 'Corsa', year: 2008, engine: null, source: 'vin',
    });
  });

  it('falls back to the user-confirmed identity when VIN decode failed', () => {
    const brief = buildBrief(input({
      vehicle: vehicle({ make: 'Unknown', model: 'Unknown', year: null }),
      userIdentity: { make: 'Fiat', model: 'Palio', year: 2013, engine: '1.4' },
    }));
    expect(brief.identity).toEqual({
      make: 'Fiat', model: 'Palio', year: 2013, engine: '1.4', source: 'user',
    });
  });

  it('user fields fill gaps the VIN path left (engine, year)', () => {
    const brief = buildBrief(input({
      vehicle: vehicle({ year: null }),
      userIdentity: { make: null, model: null, year: 2008, engine: '1.6' },
    }));
    expect(brief.identity.source).toBe('vin');
    expect(brief.identity.year).toBe(2008);
    expect(brief.identity.engine).toBe('1.6');
  });

  it('all-null when nothing is known (source: unknown)', () => {
    const brief = buildBrief(input());
    expect(brief.identity.source).toBe('unknown');
    expect(brief.identity.make).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The brief NEVER carries a VIN — the ADR-0009 data contract
// ---------------------------------------------------------------------------

describe('buildBrief — data contract', () => {
  it('the brief and its rendered prompt contain no VIN even when the vehicle has one', () => {
    const brief = buildBrief(input({
      vehicle: vehicle(),
      troubleCodes: [dtc('P0302', 'critical')],
      userNotes: 'el vin es 3G1SF21649S123456 y la patente AB 123 CD',
    }));
    const serialized = JSON.stringify(brief);
    expect(serialized).not.toContain('3G1SF21649S123456');
    expect(serialized).not.toContain('AB 123 CD');
    expect(renderBriefPrompt(brief)).not.toContain('3G1SF21649S123456');
    expect(brief.userNotes).toContain(REDACTED);
  });
});

// ---------------------------------------------------------------------------
// Fault class wiring (M0) and reading order determinism
// ---------------------------------------------------------------------------

describe('buildBrief — composition', () => {
  it('attaches the deterministic fault class to each DTC', () => {
    const brief = buildBrief(input({ troubleCodes: [dtc('P0302', 'critical'), dtc('P1601', 'warning')] }));
    expect(brief.dtcs[0]?.faultClassId).toBe('misfire_cylinder');
    expect(brief.dtcs[1]?.faultClassId).toBeNull(); // unmapped degrades gracefully
  });

  it('orders live readings by DASHBOARD_PIDS regardless of snapshot key order', () => {
    const snapshot: ObdParameterSnapshot = {
      VOLTAGE: param('VOLTAGE', 13.8),
      RPM: param('RPM', 850),
      COOLANT_TEMP: param('COOLANT_TEMP', 92),
    };
    const brief = buildBrief(input({ parameters: snapshot }));
    expect(brief.liveReadings.map((r) => r.pid)).toEqual(['RPM', 'COOLANT_TEMP', 'VOLTAGE']);
  });

  it('maps symptom ids to labels and drops unknown ids', () => {
    const brief = buildBrief(input({ symptomIds: ['sym_rough_idle', 'not_a_symptom'] }));
    expect(brief.symptoms).toEqual([{ id: 'sym_rough_idle', label: 'Rough / shaky idle' }]);
  });
});

// ---------------------------------------------------------------------------
// G0 readiness checklist
// ---------------------------------------------------------------------------

describe('briefReadiness (G0)', () => {
  const completeInput = () => input({
    vehicle: vehicle(),
    troubleCodes: [dtc('P0302', 'critical')],
  });

  it('ready with full identity + DTC evidence', () => {
    expect(briefReadiness(buildBrief(completeInput()))).toEqual({ ready: true, missing: [] });
  });

  it('a live snapshot also counts as OBD evidence (no DTCs needed)', () => {
    const brief = buildBrief(input({
      vehicle: vehicle(),
      parameters: { RPM: param('RPM', 850) },
    }));
    expect(briefReadiness(brief).ready).toBe(true);
  });

  it('reports each missing identity field', () => {
    const brief = buildBrief(input({ troubleCodes: [dtc('P0302', 'critical')] }));
    expect(briefReadiness(brief)).toEqual({ ready: false, missing: ['make', 'model', 'year'] });
  });

  it('symptoms alone are NOT enough — the senior call needs vehicle-state data', () => {
    const brief = buildBrief(input({
      vehicle: vehicle(),
      symptomIds: ['sym_rough_idle', 'sym_cel_flashing'],
    }));
    expect(briefReadiness(brief)).toEqual({ ready: false, missing: ['obd_evidence'] });
  });
});

// ---------------------------------------------------------------------------
// Prompt renderer
// ---------------------------------------------------------------------------

describe('renderBriefPrompt', () => {
  const fullBrief = () => buildBrief(input({
    vehicle: vehicle(),
    mileageKm: 152000,
    troubleCodes: [dtc('P0302', 'critical', 'Cylinder 2 Misfire Detected')],
    parameters: {
      RPM: param('RPM', 850),
      COOLANT_TEMP: param('COOLANT_TEMP', 112, { severity: 'critical', message: 'Coolant temperature high' }),
    },
    symptomIds: ['sym_rough_idle', 'sym_cel_flashing'],
    userNotes: 'tiembla en frío y mejora en caliente',
  }));

  it('renders every section with the case data', () => {
    const prompt = renderBriefPrompt(fullBrief());
    expect(prompt).toContain('Chevrolet Corsa 2008');
    expect(prompt).toContain('152000 km');
    expect(prompt).toContain('P0302 [critical] Cylinder 2 Misfire Detected');
    expect(prompt).toContain('misfire_cylinder');
    expect(prompt).toContain('Engine state: running');
    expect(prompt).toContain('Coolant temperature high');
    expect(prompt).toContain('Rough / shaky idle');
    expect(prompt).toContain('Check engine light FLASHING');
    expect(prompt).toContain('tiembla en frío');
  });

  it('is deterministic — same input, same prompt', () => {
    expect(renderBriefPrompt(fullBrief())).toBe(renderBriefPrompt(fullBrief()));
  });

  it('states the gaps honestly when data is missing', () => {
    const prompt = renderBriefPrompt(buildBrief(input()));
    expect(prompt).toContain('No stored DTCs');
    expect(prompt).toContain('No live snapshot available');
    expect(prompt).toContain('None reported');
  });
});

// ---------------------------------------------------------------------------
// redactText (unit)
// ---------------------------------------------------------------------------

describe('redactText', () => {
  const CASES: ReadonlyArray<[string, string]> = [
    ['vin 3G1SF21649S123456 ok', `vin ${REDACTED} ok`],
    ['patente AB123CD', `patente ${REDACTED}`],
    ['patente AB 123 CD', `patente ${REDACTED}`],
    ['patente vieja ABC 123', `patente vieja ${REDACTED}`],
    ['escribime a juan.perez@mail.com', `escribime a ${REDACTED}`],
  ];

  it.each(CASES)('"%s"', (text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  it('leaves technical prose intact (years, DTCs, RPM lists, lowercase words)', () => {
    const text = 'P0302 desde 2008, falla entre los 300 y 3000 rpm, es 120 km de uso';
    expect(redactText(text)).toBe(text);
  });
});
