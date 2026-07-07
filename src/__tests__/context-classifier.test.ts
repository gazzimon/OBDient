// Tests for context-classifier.ts — deterministic VehicleState (PLAN-002 M1).
// Pure function, no mocks needed.

import { classifyVehicleState } from '@/domain/services/context-classifier';
import type { ObdParameter, ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { PidId, AlertSeverity } from '@/core/constants/pids';
import { PID_DEFINITIONS } from '@/core/constants/pids';
import type { DtcSeverity } from '@/core/utils/dtcParser';

const T0 = new Date('2026-07-01T12:00:00Z');

function param(
  pid: PidId,
  value: number,
  alert: { severity: AlertSeverity; message: string } | null = null,
): ObdParameter {
  const def = PID_DEFINITIONS[pid];
  return { pid, name: def.name, value, unit: def.unit, timestamp: T0, alert };
}

function dtc(code: string, severity: DtcSeverity): TroubleCode {
  return {
    id: `${code}-test`,
    code,
    system: 'P',
    description: `test ${code}`,
    severity,
    detectedAt: T0,
    interpretation: null,
  };
}

describe('classifyVehicleState — engineState', () => {
  it('is unknown when the RPM PID is absent', () => {
    expect(classifyVehicleState({}, []).engineState).toBe('unknown');
  });

  it('is running when RPM > 0', () => {
    const snapshot: ObdParameterSnapshot = { RPM: param('RPM', 850) };
    expect(classifyVehicleState(snapshot, []).engineState).toBe('running');
  });

  it('is no_start when RPM === 0 (key-on engine-off)', () => {
    const snapshot: ObdParameterSnapshot = { RPM: param('RPM', 0) };
    expect(classifyVehicleState(snapshot, []).engineState).toBe('no_start');
  });
});

describe('classifyVehicleState — aggregateSeverity', () => {
  const CASES: ReadonlyArray<[DtcSeverity[], string]> = [
    [[], 'none'],
    [['info'], 'info'],
    [['info', 'warning'], 'warning'],
    [['warning', 'info', 'critical'], 'critical'],
    [['critical', 'critical'], 'critical'],
  ];

  it.each(CASES)('%j → %s', (severities, expected) => {
    const dtcs = severities.map((s, i) => dtc(`P010${i}`, s));
    expect(classifyVehicleState({}, dtcs).aggregateSeverity).toBe(expected);
  });
});

describe('classifyVehicleState — activeAlerts', () => {
  it('collects only params whose mapper-set alert is non-null', () => {
    const snapshot: ObdParameterSnapshot = {
      COOLANT_TEMP: param('COOLANT_TEMP', 112, { severity: 'critical', message: 'Coolant high' }),
      VOLTAGE: param('VOLTAGE', 11.2, { severity: 'warning', message: 'Voltage low' }),
      RPM: param('RPM', 850),
    };
    const alerts = classifyVehicleState(snapshot, []).activeAlerts;
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.pid).sort()).toEqual(['COOLANT_TEMP', 'VOLTAGE']);
  });

  it('does NOT re-evaluate thresholds — a breaching value with alert:null stays silent', () => {
    // 130°C is way above the 105°C critical threshold, but the mapper said null:
    // the classifier must trust the single source of truth, not recompute.
    const snapshot: ObdParameterSnapshot = { COOLANT_TEMP: param('COOLANT_TEMP', 130, null) };
    expect(classifyVehicleState(snapshot, []).activeAlerts).toHaveLength(0);
  });
});

describe('classifyVehicleState — presentPids and inert hardware flags', () => {
  it('lists exactly the PIDs present in the snapshot', () => {
    const snapshot: ObdParameterSnapshot = {
      RPM: param('RPM', 850),
      MAF: param('MAF', 12.3),
    };
    const state = classifyVehicleState(snapshot, []);
    expect([...state.presentPids].sort()).toEqual(['MAF', 'RPM']);
  });

  it('readinessComplete and hasFreezeFrame stay false (inert until M6/M7)', () => {
    const state = classifyVehicleState({ RPM: param('RPM', 850) }, [dtc('P0302', 'critical')]);
    expect(state.readinessComplete).toBe(false);
    expect(state.hasFreezeFrame).toBe(false);
  });
});

describe('classifyVehicleState — determinism', () => {
  it('same input produces deeply equal output', () => {
    const snapshot: ObdParameterSnapshot = {
      RPM: param('RPM', 850),
      COOLANT_TEMP: param('COOLANT_TEMP', 112, { severity: 'critical', message: 'Coolant high' }),
    };
    const dtcs = [dtc('P0302', 'critical'), dtc('P0420', 'warning')];
    expect(classifyVehicleState(snapshot, dtcs)).toEqual(classifyVehicleState(snapshot, dtcs));
  });
});
