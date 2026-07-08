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
  // Owner descriptions with substance that matched no taxonomy entry (raw;
  // redacted here). Provenance: user (ADR-0009 "catalog, never discard").
  readonly describedSymptoms: readonly string[];
  readonly deniedSymptomIds: readonly string[];
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
  const fuelType = user?.fuelType ?? null;

  let source: IdentitySource = 'unknown';
  if (vinMake != null) source = 'vin';
  else if (make != null || model != null || year != null) source = 'user';

  return { make, model, year, engine, fuelType, source };
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

  const toSymptoms = (ids: readonly string[]): BriefSymptom[] =>
    ids.flatMap((id): BriefSymptom[] => {
      const node = SYMPTOM_MAP[id];
      return node != null ? [{ id, label: node.label }] : [];
    });

  return {
    identity: resolveIdentity(input.vehicle, input.userIdentity),
    mileageKm: input.mileageKm ?? input.userIdentity?.mileageKm ?? null,
    dtcs,
    vehicleState: classifyVehicleState(input.parameters, input.troubleCodes),
    liveReadings,
    symptoms: toSymptoms(input.symptomIds),
    describedSymptoms: input.describedSymptoms.map((s) => redactText(s)),
    deniedSymptoms: toSymptoms(input.deniedSymptomIds),
    userNotes: input.userNotes != null ? redactText(input.userNotes) : null,
    createdAt: input.now,
  };
}

// G0 — the vehicle-facts checklist. Identity (make+model+year) + mileage.
// OBD evidence is deliberately NOT required: QVAC can diagnose from reported
// symptoms with the scanner mute (ADR-0006-A). DTCs and live readings still
// enrich the brief whenever they are present. The "at least one symptom"
// requirement lives in the intake session (it is evidence, not a vehicle fact).
export function briefReadiness(brief: DiagnosticBrief): BriefReadiness {
  const missing: MissingField[] = [];
  if (brief.identity.make == null) missing.push('make');
  if (brief.identity.model == null) missing.push('model');
  if (brief.identity.year == null) missing.push('year');
  if (brief.mileageKm == null) missing.push('mileage');

  return { ready: missing.length === 0, missing };
}

// True when the case has any fault evidence to diagnose from — reported
// symptoms OR real OBD data. The intake needs at least one of these before
// asking QVAC for a diagnosis.
export function hasObdEvidence(brief: DiagnosticBrief): boolean {
  return brief.dtcs.length > 0 || brief.vehicleState.presentPids.length > 0;
}

// ---------------------------------------------------------------------------
// Prompt renderers — deterministic templates over the brief.
// English per PLAN-002 editor decision; both agents mirror the owner's language.
// The case sections are shared: the same evidence feeds the local (junior)
// preliminary diagnosis and, only on user opt-in, the ONE senior call.
// ---------------------------------------------------------------------------

// The case file body: vehicle, OBD evidence, owner-reported symptoms.
function renderCaseSections(brief: DiagnosticBrief): string[] {
  const lines: string[] = ['## Vehicle'];

  const { make, model, year, engine, fuelType, source } = brief.identity;
  const idParts = [make ?? 'unknown make', model ?? 'unknown model', year != null ? String(year) : 'unknown year'];
  const engineBits = [engine != null ? `engine ${engine}` : null, fuelType].filter(Boolean).join(' ');
  const engineStr = engineBits.length > 0 ? `, ${engineBits}` : '';
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
    lines.push('- None matched the symptom catalog.');
  }
  if (brief.describedSymptoms.length > 0) {
    lines.push('- Owner-described (not in catalog, verbatim):');
    for (const d of brief.describedSymptoms) lines.push(`  - "${d}"`);
  }
  if (brief.deniedSymptoms.length > 0) {
    lines.push('- Explicitly DENIED by the owner (negative evidence):');
    for (const s of brief.deniedSymptoms) lines.push(`  - ${s.label}`);
  }
  if (brief.userNotes != null && brief.userNotes.trim().length > 0) {
    lines.push(`- Owner notes (interview answers, verbatim): "${brief.userNotes.trim()}"`);
  }

  return lines;
}

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
  );
  lines.push(...renderCaseSections(brief));

  lines.push(
    '',
    '## Your reply',
    'Structure your first reply as:',
    '1) Most likely cause (one line) and why.',
    '2) Ranked checks, cheapest first, that the owner can do or ask a shop for.',
    '3) One question back to the owner if something key is still missing.',
    "Reply in the language of the owner's words above.",
  );

  return lines.join('\n');
}

// Preliminary diagnosis prompt for the on-device junior (fase 2 of the token
// pipeline): same deterministic case file, tuned for a small local model —
// short, structured, and honest that a senior review is available on demand.
export function renderLocalDiagnosisPrompt(brief: DiagnosticBrief, language: 'es' | 'en'): string {
  const replyLanguage = language === 'es' ? 'Spanish' : 'English';
  const lines: string[] = [];

  lines.push(
    'You are the on-device diagnostic assistant of OBDient. The intake below was',
    'collected from a real vehicle over OBD-II. Give your PRELIMINARY diagnosis.',
    '',
  );
  lines.push(...renderCaseSections(brief));
  lines.push(
    '',
    '## Your reply',
    'Be concise and practical. Structure it as:',
    '1) Most likely cause (one line).',
    '2) Up to 3 checks the owner can do, cheapest first.',
    'Do not invent readings that are not in the case file.',
    `Reply in ${replyLanguage}.`,
  );

  return lines.join('\n');
}
