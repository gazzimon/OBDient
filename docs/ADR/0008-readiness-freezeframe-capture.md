# ADR-0008: Readiness & freeze-frame capture (Mode 01 PID 01 / Mode 02; Mode 06 out)

- **Status:** Proposed
- **Date:** 2026-06-26
- **Deciders:** Gustavo (gazzimon)
- **Related:** ADR-0004 (consumes `caseSignature` / `freezeFrame.*`), ADR-0006
  (deterministic core the gate rules run on), PLAN-001 (Phase 6, rules G7-G8),
  PLAN-002 (milestones M6/M7)
- **Affected repos:** `gazzimon/OBDient` (`elm327.datasource.ts`, `obdParser.ts`,
  `core/constants/pids.ts`, `domain/services/context-classifier.ts`,
  `domain/services/diagnostic-gate.ts`, Settings feature flag)

---

## Context and problem

The closed-loop gate of PLAN-001 / ADR-0006 commits to rules **G1-G6**, which run on
data OBDient already reads (active DTCs, live PIDs, derived `faultClass`). Two further
rules need data that is **not captured today**:

- **G7 — readiness / drive-cycle completeness.** Requires **Mode 01 PID 01** (monitor
  status since DTCs cleared). Beyond diagnosis, readiness is a strong **anti-fraud
  signal**: a car whose codes were just cleared (e.g. before a sale) shows incomplete
  readiness monitors — the reseller use case.
- **G8 — freeze-frame validation.** Requires **Mode 02** (the frozen RPM/load/temp at
  the moment the DTC set). It lets the gate check a hypothesis against the conditions
  that actually triggered the fault.

`elm327.datasource.ts` / `obdParser.ts` only implement Mode 01 live PIDs and Mode 03
DTCs today (see PLAN-001 §0). Adding Mode 01 PID 01, Mode 02, and Mode 06 each drags a
new hardware/protocol dependency: ELM327 compatibility variance and read latency. This
risk must not bleed into the LOW-MED gate MVP.

There is also a known inconsistency: ADR-0004's `caseSignature` already assumes
`freezeFrame.*` fields that are never populated.

## Decision drivers

- **Don't contaminate the gate MVP.** G1-G6 ship with zero new hardware (PLAN-002
  M0-M3). Hardware-dependent rules are isolated behind a feature flag.
- **Value-first sequencing.** Readiness has immediate, standalone value (fraud
  detection) independent of the rest of the gate.
- **Graceful degradation.** The system already degrades when data is absent; the same
  principle resolves the `caseSignature` drift without a rushed capture path.
- **ELM327 reality.** Mode 06 has the worst adapter compatibility and lowest immediate
  value; it should not block anything.

## Decision

Capture readiness and freeze frame as **two staged, feature-flagged milestones**,
**separate from the gate MVP**, in this priority order:

1. **Readiness — Mode 01 PID 01 (PLAN-002 M6, first).** Add the command + parser +
   PID definitions. Populate `VehicleState.readinessComplete`. Activates **G7** and the
   **anti-fraud (reset-car) detection** for the reseller use case.
2. **Freeze frame — Mode 02 (PLAN-002 M7, second).** Add capture + parser. Populate
   `VehicleState.hasFreezeFrame` and the frozen-condition fields. Activates **G8** and
   gives the diagnosis the conditions that triggered the DTC.
3. **Mode 06 — out of scope.** Deferred to a future predictive-analysis effort; not
   committed by this ADR (worst ELM327 compatibility, lowest immediate value).

### Explicit boundary: flags off ⇒ inert

While the flags are off, `readinessComplete` and `hasFreezeFrame` stay `false` and
G7-G8 are inert — exactly as PLAN-001 Pattern 3 already foresees. The gate MVP (G1-G6)
behaves identically with or without this ADR implemented.

### Resolving the `caseSignature` drift

The `freezeFrame.*` fields that ADR-0004's `caseSignature` assumes are resolved by
**graceful degradation in `bucket()`** (treat missing freeze-frame as an absent bucket
dimension), **not** by collecting freeze frame hastily to satisfy the schema. Capture
arrives properly via M7; until then the signature degrades cleanly.

## Phased plan

- **Phase 0 — Flag + inert plumbing.** Settings feature flag; `VehicleState` fields
  wired but always `false`. Zero behavior change.
- **Phase 1 — Readiness (Mode 01 PID 01).** Command, parser, PIDs; G7 + anti-fraud
  surface. Behind the flag.
- **Phase 2 — Freeze frame (Mode 02).** Capture, parser, frozen-condition fields; G8.
  Behind the flag.
- **Future — Mode 06.** Not in this ADR.

## Consequences

### Positive
- Gate MVP stays LOW-MED risk and hardware-free; HIGH-risk hardware is fully isolated.
- Readiness delivers standalone anti-fraud value (reseller / reset-car detection).
- `caseSignature` drift closed by an explicit degradation rule, not premature capture.

### Negative / costs
- New ELM327 commands carry adapter-compatibility and latency risk.
- A feature flag and two inert `VehicleState` fields to maintain until the flags ship.

### Risks and mitigations
- **ELM327 variance / no support for Mode 02 or PID 01** → graceful degradation: rule
  stays inert, no diagnosis regression.
- **Read latency on slow adapters** → capture off the diagnostic hot path; flag lets
  users opt out.

## Alternatives considered

- **Include G7-G8 in the gate MVP:** rejected. Drags HIGH hardware risk into the LOW-MED
  core; contradicts PLAN-002's north star.
- **Commit Mode 06 now:** rejected. Worst compatibility, lowest immediate value; future
  predictive-analysis territory.
- **Collect freeze frame eagerly to satisfy `caseSignature`:** rejected. Premature
  hardware dependency for a schema field; graceful degradation in `bucket()` is cleaner.
