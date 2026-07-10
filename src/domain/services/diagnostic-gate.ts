// Deterministic anti-hallucination gate over free prose (PLAN-002 v2, N1).
//
// Validates a diagnostic answer — junior (CARpsy) or senior (Claude) — against
// the vehicle's REAL data: active DTCs and the deterministic VehicleState (M1).
// No LLM, no I/O, no clock: pure `(text, ctx) → GateResult`, table-testable.
//
// Gate-as-FILTER, not gate-as-retry: the caller marks a failing answer as
// *unconfirmed* (honest fallback) — it never regenerates in a loop on-device.
// The same verdict is the admission valve for the distillation harvest (N3):
// only gate-passed senior answers become knowledge/dataset.
//
// Bias: generous coherence sets, few false accusations — an anti-hallucination
// gate must itself not hallucinate violations. Rules degrade gracefully (inert)
// whenever the data to judge is missing.

import type { VehicleState } from '@/domain/entities/diagnostic-context';
import { OBD_ONTOLOGY } from '@/data/knowledge/obd-ontology';
import { faultClassClosure } from './fault-class';

/** Minimal structural view of an active DTC — callers pass TroubleCode[]. */
export interface GateDtc {
  readonly code: string; // e.g. "P0420"
}

export interface GateContext {
  readonly dtcs: readonly GateDtc[];
  readonly state: VehicleState;
}

export type GateRuleId = 'G1' | 'G2' | 'G3' | 'G5';

/** hard → factually wrong vs the car's data (answer marked unconfirmed).
 *  soft → tone/urgency mismatch (annotation only, never blocks). */
export type GateWeight = 'hard' | 'soft';

export interface GateViolation {
  readonly rule: GateRuleId;
  readonly weight: GateWeight;
  readonly detail: string;
}

export interface GateResult {
  /** true when there are no HARD violations (soft ones only annotate). */
  readonly passed: boolean;
  readonly violations: readonly GateViolation[];
  /** DTC-shaped tokens found in the text (normalized, deduped). */
  readonly citedDtcs: readonly string[];
  /** Ontology concepts the prose mentions (first candidate per matched keyword). */
  readonly mentionedConcepts: readonly string[];
}

// ---------------------------------------------------------------------------
// G2 — cited DTCs exist (highest-value anti-hallucination check)
// ---------------------------------------------------------------------------

// DTC-shaped token in prose: system letter + 4 hex digits (same convention as
// dtcParser / fault-class). Word boundaries keep part numbers etc. out.
const DTC_TOKEN = /\b[PBCU][0-9A-F]{4}\b/gi;

function extractCitedDtcs(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(DTC_TOKEN)) {
    seen.add(match[0].toUpperCase());
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// G1 — fault-domain coherence (keyword table → SKOS concepts)
// ---------------------------------------------------------------------------

// Deterministic es/en keyword map. A mention is coherent if ANY of its candidate
// concepts belongs to the coherence set of some active DTC. Only specific
// component/domain terms — never generic words, never root concepts.
interface ConceptKeyword {
  readonly pattern: RegExp;
  readonly concepts: readonly string[];
}

const CONCEPT_KEYWORDS: readonly ConceptKeyword[] = [
  { pattern: /cataly|catalizador/i, concepts: ['catalyst'] },
  { pattern: /misfire|fallos? de encendido/i, concepts: ['misfire_random', 'misfire_cylinder', 'ignition'] },
  { pattern: /spark plug|buj[ií]a/i, concepts: ['ignition', 'misfire_random', 'misfire_cylinder'] },
  { pattern: /injector|inyector/i, concepts: ['fuel_injectors'] },
  { pattern: /fuel pump|fuel (rail )?pressure|bomba de (combustible|nafta)|presi[oó]n de combustible/i, concepts: ['fuel_delivery'] },
  { pattern: /(running|too|system) lean|mezcla pobre/i, concepts: ['fuel_lean', 'fuel_mixture'] },
  { pattern: /(running|too|system) rich|mezcla rica/i, concepts: ['fuel_rich', 'fuel_mixture'] },
  { pattern: /o2 sensor|oxygen sensor|sonda lambda|sensor de ox[ií]geno/i, concepts: ['sensor_o2'] },
  { pattern: /\bmaf\b|mass air ?flow|caudal[ií]metro/i, concepts: ['sensor_maf'] },
  { pattern: /crankshaft|cig[üu]e[ñn]al/i, concepts: ['sensor_crank', 'timing_correlation'] },
  { pattern: /camshaft|[aá]rbol de levas/i, concepts: ['sensor_cam', 'vvt', 'timing_correlation'] },
  { pattern: /knock sensor|sensor de detonaci[oó]n/i, concepts: ['sensor_knock'] },
  { pattern: /thermostat|termostato/i, concepts: ['sensor_temperature'] },
  { pattern: /\bevap\b|evaporative|gas cap|fuel cap|tapa de (combustible|nafta)/i, concepts: ['evap'] },
  { pattern: /\begr\b/i, concepts: ['egr'] },
  { pattern: /\bvvt\b|variable valve/i, concepts: ['vvt'] },
  { pattern: /timing (chain|belt)|correa de distribuci[oó]n|cadena de distribuci[oó]n/i, concepts: ['timing_correlation', 'vvt'] },
  { pattern: /throttle|mariposa|cuerpo de aceleraci[oó]n/i, concepts: ['throttle'] },
  { pattern: /turbo/i, concepts: ['turbo'] },
  { pattern: /transmission|transmisi[oó]n|gearbox|caja de cambios/i, concepts: ['transmission'] },
];

// SKOS `related` is symmetric by definition, but the ontology declares each
// edge on one side only (e.g. sensor_o2 → catalyst: checking the O2 sensor IS
// coherent with a P0420). Reverse index built once at module load.
const REVERSE_RELATED: Readonly<Record<string, readonly string[]>> = (() => {
  const map: Record<string, string[]> = {};
  for (const node of OBD_ONTOLOGY) {
    for (const rel of node.related) {
      (map[rel] ??= []).push(node.id);
    }
  }
  return map;
})();

/** Coherence set of one DTC: its SKOS closure (concept + ancestors) PLUS the
 *  canonical concept's `related` edges in BOTH directions — the ontology's
 *  cross-branch edges do real work here ("injector" is coherent with P0302 via
 *  misfire_cylinder; "oxygen sensor" with P0420 via sensor_o2 → catalyst). */
function coherenceSetFor(dtc: string): Set<string> | null {
  const closure = faultClassClosure(dtc);
  if (closure.length === 0) return null; // unmapped code — unknown domain
  const set = new Set<string>(closure.map((c) => c.id));
  const canonical = closure[0]!;
  for (const rel of canonical.related) set.add(rel);
  for (const rel of REVERSE_RELATED[canonical.id] ?? []) set.add(rel);
  return set;
}

// ---------------------------------------------------------------------------
// G5 — engine-state coherence / G3 — urgency coherence
// ---------------------------------------------------------------------------

const NO_START_CLAIM =
  /won'?t start|doesn'?t start|does not start|fail(s|ed)? to start|no arranca|no enciende|no prende/i;

const URGENT_CLAIM =
  /do not (continue )?driv|stop driving|not safe to drive|no conduzca|no sigas? conduciendo|dej[ae] de conducir|no es seguro conducir/i;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export function runGate(text: string, ctx: GateContext): GateResult {
  const violations: GateViolation[] = [];
  const activeCodes = new Set(ctx.dtcs.map((d) => d.code.trim().toUpperCase()));

  // G2 — every DTC the prose cites must be an active code.
  const citedDtcs = extractCitedDtcs(text);
  for (const cited of citedDtcs) {
    if (!activeCodes.has(cited)) {
      violations.push({
        rule: 'G2',
        weight: 'hard',
        detail: `cites DTC ${cited}, which is not among the vehicle's active codes`,
      });
    }
  }

  // G1 — every fault-domain mention must be coherent with some active DTC.
  // Inert without DTCs, or when ANY active code is unmapped in the ontology
  // (its domain is unknown — never accuse from ignorance).
  const mentionedConcepts: string[] = [];
  const coherenceSets: Set<string>[] = [];
  let g1Active = activeCodes.size > 0;
  for (const code of activeCodes) {
    const set = coherenceSetFor(code);
    if (set === null) {
      g1Active = false;
      break;
    }
    coherenceSets.push(set);
  }

  for (const kw of CONCEPT_KEYWORDS) {
    const match = kw.pattern.exec(text);
    if (!match) continue;
    mentionedConcepts.push(kw.concepts[0]!);
    if (!g1Active) continue;
    const coherent = kw.concepts.some((c) => coherenceSets.some((set) => set.has(c)));
    if (!coherent) {
      violations.push({
        rule: 'G1',
        weight: 'hard',
        detail: `mentions "${match[0]}" (${kw.concepts[0]}) but no active DTC belongs to that fault domain`,
      });
    }
  }

  // G5 — a no-start claim contradicts live RPM evidence of a running engine.
  // Only fires on real evidence: engineState 'unknown' / 'no_start' is inert.
  if (ctx.state.engineState === 'running' && NO_START_CLAIM.test(text)) {
    violations.push({
      rule: 'G5',
      weight: 'hard',
      detail: 'claims the engine does not start, but live RPM shows it running',
    });
  }

  // G3 (soft) — "do not drive" urgency with only info/none DTC severity and no
  // critical live alert. Annotation only; urgency itself is never blocked.
  const severityJustifiesUrgency =
    ctx.state.aggregateSeverity === 'critical' ||
    ctx.state.aggregateSeverity === 'warning' ||
    ctx.state.activeAlerts.some((a) => a.severity === 'critical');
  if (!severityJustifiesUrgency && URGENT_CLAIM.test(text)) {
    violations.push({
      rule: 'G3',
      weight: 'soft',
      detail: 'urgent do-not-drive tone, but no DTC or live alert justifies it',
    });
  }

  return {
    passed: !violations.some((v) => v.weight === 'hard'),
    violations,
    citedDtcs,
    mentionedConcepts,
  };
}
