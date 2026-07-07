// Deterministic DTC → FaultClass resolution (PLAN-002 M0 / ADR-0006 Phase 0).
//
// Consolidates the two halves of the "DTC → fault class" mapping that were
// previously dispersed:
//   - dtcParser.classifySeverity()  → SAE J2012 range heuristics (severity)
//   - obd-ontology DTC_TO_CONCEPT   → canonical SKOS concept (taxonomy)
//
// Unlike conceptForDtc() — which only matches ontology keys verbatim, including
// range ids like "P0301-P0308" — this module resolves CONCRETE codes (e.g.
// "P0302") against those ranges, so gate rules can work on real scanner output.
//
// Pure: no I/O, no LLM, no async. Runs in plain Node against fixtures.

import { classifySeverity, DtcSeverity } from '@/core/utils/dtcParser';
import {
  DTC_TO_CONCEPT,
  ancestors,
  SkosConceptNode,
} from '@/data/knowledge/obd-ontology';

export interface FaultClass {
  readonly dtc: string;              // normalized code, e.g. "P0302"
  readonly severity: DtcSeverity;    // SAE J2012 range heuristic
  readonly conceptId: string | null; // canonical SKOS concept id, null if unmapped
  readonly label: string | null;     // canonical concept label, null if unmapped
}

// Concrete DTC shape: system letter + 4 hex digits (numeric part is hex,
// e.g. P0A00 — same convention as dtcParser)
const DTC_SHAPE = /^[PBCU][0-9A-F]{4}$/;

// Ontology range id shape: both endpoints share the system letter ("P0301-P0308")
const RANGE_SHAPE = /^([PBCU])([0-9A-F]{4})-\1([0-9A-F]{4})$/;

interface DtcRange {
  readonly system: string;
  readonly from: number;
  readonly to: number;
  readonly concept: SkosConceptNode;
}

// Parsed once at module load, preserving ontology declaration order so range
// resolution is deterministic even if ranges ever overlap.
const DTC_RANGES: readonly DtcRange[] = Object.entries(DTC_TO_CONCEPT).flatMap(
  ([id, concept]): DtcRange[] => {
    const match = RANGE_SHAPE.exec(id);
    const system = match?.[1];
    const from = match?.[2];
    const to = match?.[3];
    if (system === undefined || from === undefined || to === undefined) return [];
    return [{ system, from: parseInt(from, 16), to: parseInt(to, 16), concept }];
  },
);

function normalize(dtc: string): string {
  return dtc.trim().toUpperCase();
}

// Exact ontology key first (covers both single codes and verbatim range ids),
// then range membership for concrete codes.
function canonicalConcept(code: string): SkosConceptNode | null {
  const exact = DTC_TO_CONCEPT[code];
  if (exact) return exact;

  if (!DTC_SHAPE.test(code)) return null;
  const system = code[0];
  const numeric = parseInt(code.slice(1), 16);

  for (const range of DTC_RANGES) {
    if (range.system === system && numeric >= range.from && numeric <= range.to) {
      return range.concept;
    }
  }
  return null;
}

/** Resolves a DTC to its deterministic fault class: severity + canonical SKOS
 *  concept. Always returns a value — an unmapped code keeps its severity
 *  heuristic with a null concept (graceful degradation). */
export function faultClassFor(dtc: string): FaultClass {
  const code = normalize(dtc);
  const concept = canonicalConcept(code);
  return {
    dtc: code,
    severity: classifySeverity(code),
    conceptId: concept?.id ?? null,
    label: concept?.label ?? null,
  };
}

/** SKOS closure of a DTC: canonical concept followed by its ancestor chain up
 *  to the root (the `subClassOf` closure of ADR-0001). Empty if unmapped. */
export function faultClassClosure(dtc: string): SkosConceptNode[] {
  const concept = canonicalConcept(normalize(dtc));
  if (!concept) return [];
  return [concept, ...ancestors(concept.id)];
}

/** Gate rule G1 primitive: does `conceptId` belong to the SKOS closure of this
 *  DTC? A hypothesis whose fault class fails this for every active DTC is
 *  incoherent with the vehicle's actual codes. */
export function isInFaultClassClosure(dtc: string, conceptId: string): boolean {
  return faultClassClosure(dtc).some((c) => c.id === conceptId);
}
