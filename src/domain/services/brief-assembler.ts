// Deterministic assembly of the DiagnosticBrief and its senior prompt
// (ADR-0009 §2). Pure: same session state ⇒ same brief ⇒ same prompt.
// The local LLM interviews; THIS code composes what travels.

import type { Vehicle } from '@/domain/entities/vehicle';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type {
  DiagnosticBrief,
  BriefVehicleIdentity,
  BriefDtc,
  BriefReading,
  BriefSymptom,
  BriefReadiness,
  MissingField,
  IdentitySource,
} from '@/domain/entities/diagnostic-brief';
import type { ParsedVehicleIdentity } from '@/domain/services/vehicle-identity-parser';
import { faultClassFor } from '@/domain/services/fault-class';
import { classifyVehicleState } from '@/domain/services/context-classifier';
import { SYMPTOM_MAP } from '@/data/knowledge/symptom-ontology';
import { DASHBOARD_PIDS } from '@/core/constants/pids';
import { redactText } from '@/core/utils/redact';

export interface BriefInput {
  // From the VIN-decode path (connect-to-vehicle); may be null or 'Unknown'
  readonly vehicle: Vehicle | null;
  // Confirmed manual correction captured by the intake (parser + user OK)
  readonly userIdentity: ParsedVehicleIdentity | null;
  readonly mileageKm: number | null;
  readonly troubleCodes: readonly TroubleCode[];
  readonly parameters: ObdParameterSnapshot;
  readonly symptomIds: readonly string[];
  readonly userNotes: string | null; // raw; redacted here before it enters the brief
  readonly now: number;              // epoch ms, injected (ClockPort discipline)
}

// Identity precedence (ADR-0009 §1): decoded VIN > user correction > unknown.
// A user-confirmed field fills whatever the VIN decode left empty.
function resolveIdentity(
  vehicle: Vehicle | null,
  user: ParsedVehicleIdentity | null,
): BriefVehicleIdentity {
  const vinMake = vehicle != null && vehicle.make !== 'Unknown' ? vehicle.make : null;
  const vinModel = vehicle != null && vehicle.model !== 'Unknown' ? vehicle.model : null;
  const vinYear = vehicle?.year ?? null;

  const make = vinMake ?? user?.make ?? null;
  const model = vinModel ?? user?.model ?? null;
  const year = vinYear ?? user?.year ?? null;
  const engine = user?.engine ?? null; // VIN path does not decode displacement today

  let source: IdentitySource = 'unknown';
  if (vinMake != null) source = 'vin';
  else if (make != null || model != null || year != null) source = 'user';

  return { make, model, year, engine, source };
}

export function buildBrief(input: BriefInput): DiagnosticBrief {
  const dtcs: BriefDtc[] = input.troubleCodes.map((dtc) => {
    const fc = faultClassFor(dtc.code);
    return {
      code: dtc.code,
      description: dtc.description,
      severity: dtc.severity,
      faultClassId: fc.conceptId,
      faultClassLabel: fc.label,
    };
  });

  // DASHBOARD_PIDS order keeps the reading list deterministic regardless of
  // snapshot insertion order.
  const liveReadings: BriefReading[] = DASHBOARD_PIDS.flatMap((pidId): BriefReading[] => {
    const param = input.parameters[pidId];
    if (param == null) return [];
    return [{
      pid: param.pid,
      name: param.name,
      value: param.value,
      unit: param.unit,
      alert: param.alert != null ? `${param.alert.severity}: ${param.alert.message}` : null,
    }];
  });

  const symptoms: BriefSymptom[] = input.symptomIds.flatMap((id): BriefSymptom[] => {
    const node = SYMPTOM_MAP[id];
    return node != null ? [{ id, label: node.label }] : [];
  });

  return {
    identity: resolveIdentity(input.vehicle, input.userIdentity),
    mileageKm: input.mileageKm,
    dtcs,
    vehicleState: classifyVehicleState(input.parameters, input.troubleCodes),
    liveReadings,
    symptoms,
    userNotes: input.userNotes != null ? redactText(input.userNotes) : null,
    createdAt: input.now,
  };
}

// G0 — the handoff checklist (ADR-0009 §1). Identity (make+model+year) plus at
// least one piece of real OBD evidence: active DTCs or a live snapshot.
// Reported symptoms enrich the brief but do not substitute for OBD evidence —
// the senior call is only for cases with vehicle-state data.
export function briefReadiness(brief: DiagnosticBrief): BriefReadiness {
  const missing: MissingField[] = [];
  if (brief.identity.make == null) missing.push('make');
  if (brief.identity.model == null) missing.push('model');
  if (brief.identity.year == null) missing.push('year');

  const hasObdEvidence =
    brief.dtcs.length > 0 || brief.vehicleState.presentPids.length > 0;
  if (!hasObdEvidence) missing.push('obd_evidence');

  return { ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Senior prompt renderer — deterministic template over the brief.
// English per PLAN-002 editor decision; the senior mirrors the owner's language.
// ---------------------------------------------------------------------------

export function renderBriefPrompt(brief: DiagnosticBrief): string {
  const lines: string[] = [];

  lines.push(
    'You are a senior automotive diagnostic technician. A local intake agent on the',
    "owner's phone collected the case below from a real vehicle over OBD-II.",
    'Take over the diagnosis from here: give your best root-cause analysis, what to',
    'check first (ordered, cheapest first), and ask the owner follow-up questions',
    'when something is missing. Be concrete and practical. Reply in the language',
    'the owner writes in.',
    '',
    '## Vehicle',
  );

  const { make, model, year, engine, source } = brief.identity;
  const idParts = [make ?? 'unknown make', model ?? 'unknown model', year != null ? String(year) : 'unknown year'];
  const engineStr = engine != null ? `, engine ${engine}` : '';
  lines.push(`- ${idParts.join(' ')}${engineStr} (identity source: ${source})`);
  if (brief.mileageKm != null) lines.push(`- Odometer: ${brief.mileageKm} km`);

  lines.push('', '## OBD evidence');
  lines.push(
    `- Engine state: ${brief.vehicleState.engineState}` +
    ` | Aggregate DTC severity: ${brief.vehicleState.aggregateSeverity}`,
  );

  if (brief.dtcs.length > 0) {
    lines.push(`- Active DTCs (${brief.dtcs.length}):`);
    for (const dtc of brief.dtcs) {
      const fc = dtc.faultClassLabel != null
        ? ` → fault class: ${dtc.faultClassLabel} (${dtc.faultClassId})`
        : '';
      lines.push(`  - ${dtc.code} [${dtc.severity}] ${dtc.description}${fc}`);
    }
  } else {
    lines.push('- No stored DTCs.');
  }

  if (brief.liveReadings.length > 0) {
    lines.push('- Live readings:');
    for (const r of brief.liveReadings) {
      const alert = r.alert != null ? ` ⚠ ${r.alert}` : '';
      lines.push(`  - ${r.name}: ${r.value.toFixed(1)} ${r.unit}${alert}`);
    }
  } else {
    lines.push('- No live snapshot available.');
  }
  lines.push('- Readiness monitors / freeze frame: not captured by this app version.');

  lines.push('', '## Owner-reported symptoms');
  if (brief.symptoms.length > 0) {
    for (const s of brief.symptoms) lines.push(`- ${s.label}`);
  } else {
    lines.push('- None reported.');
  }
  if (brief.userNotes != null && brief.userNotes.trim().length > 0) {
    lines.push(`- Owner notes: "${brief.userNotes.trim()}"`);
  }

  return lines.join('\n');
}
