// Deterministic vehicle-state classification types (PLAN-002 M1 / ADR-0006 /
// ADR-0009). Derived ONLY from data already read over OBD — no LLM, no I/O.

import type { PidId, AlertSeverity } from '@/core/constants/pids';

// RPM-based heuristic: >0 running, ===0 key-on-engine-off, PID absent → unknown.
// 'unknown' is deliberate — a Partial snapshot must not masquerade as "no start"
// (gate rule G5 may only fire on real evidence).
export type EngineState = 'running' | 'no_start' | 'unknown';

// Max over stored DTC severities; 'none' when the DTC list is empty.
export type AggregateSeverity = 'critical' | 'warning' | 'info' | 'none';

// A live alert already computed by the PID mapper (param.alert) — collected,
// never re-evaluated, so thresholds have a single source of truth.
export interface LiveAlert {
  readonly pid: PidId;
  readonly severity: AlertSeverity;
  readonly message: string;
}

export interface VehicleState {
  readonly engineState: EngineState;
  readonly aggregateSeverity: AggregateSeverity;
  readonly activeAlerts: readonly LiveAlert[];
  // Which signals exist in the snapshot — the input of gate rule G2
  // (a cited signal must exist).
  readonly presentPids: readonly PidId[];
  // Inert until hardware milestones M6/M7 (ADR-0008). Typed now so gate rules
  // G7/G8 have their shape; always false while the feature flags are off.
  readonly readinessComplete: boolean;
  readonly hasFreezeFrame: boolean;
}
