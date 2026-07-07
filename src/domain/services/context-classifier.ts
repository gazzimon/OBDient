// Deterministic vehicle-state classifier (PLAN-002 M1 / PLAN-001 Pattern 3,
// "existing data" version). Pure: no I/O, no clock, no LLM — staleness checks
// belong to the orchestrator (ClockPort, ADR-0006), not here.

import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { PidId } from '@/core/constants/pids';
import type {
  VehicleState,
  EngineState,
  AggregateSeverity,
  LiveAlert,
} from '@/domain/entities/diagnostic-context';

const SEVERITY_RANK: Readonly<Record<Exclude<AggregateSeverity, 'none'>, number>> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function classifyEngineState(snapshot: ObdParameterSnapshot): EngineState {
  const rpm = snapshot.RPM;
  if (rpm == null) return 'unknown';
  return rpm.value > 0 ? 'running' : 'no_start';
}

function aggregateSeverity(dtcs: readonly TroubleCode[]): AggregateSeverity {
  let best: AggregateSeverity = 'none';
  let bestRank = 0;
  for (const dtc of dtcs) {
    const rank = SEVERITY_RANK[dtc.severity];
    if (rank > bestRank) {
      best = dtc.severity;
      bestRank = rank;
    }
  }
  return best;
}

// Collects alerts already computed by the PID mapper — no threshold re-evaluation.
function collectAlerts(snapshot: ObdParameterSnapshot): LiveAlert[] {
  const alerts: LiveAlert[] = [];
  for (const param of Object.values(snapshot)) {
    if (param?.alert != null) {
      alerts.push({
        pid: param.pid,
        severity: param.alert.severity,
        message: param.alert.message,
      });
    }
  }
  return alerts;
}

export function classifyVehicleState(
  snapshot: ObdParameterSnapshot,
  dtcs: readonly TroubleCode[],
): VehicleState {
  const presentPids = Object.values(snapshot)
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p): PidId => p.pid);

  return {
    engineState: classifyEngineState(snapshot),
    aggregateSeverity: aggregateSeverity(dtcs),
    activeAlerts: collectAlerts(snapshot),
    presentPids,
    // Inert until M6/M7 feature flags (ADR-0008)
    readinessComplete: false,
    hasFreezeFrame: false,
  };
}
