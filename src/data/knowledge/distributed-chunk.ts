// Typed schema for the three layers of distributed knowledge sync.
//
// All chunk types flow through the same Hypercore feed but carry a `type`
// discriminator so each layer can be processed independently.
//
// Layer 1 — FactChunk:    atomic DTC + fix observations (already existed,
//                          now formally typed). Consumed directly by SHIMI.
// Layer 2 — PatternChunk: multi-condition diagnostic patterns with scope.
//                          Evaluated at interpret-time against live OBD data.
// Layer 3 — SkosPatch:    proposed vocabulary additions to obd-ontology.
//                          Applied to the local SHIMI tree only after quorum.

// ---------------------------------------------------------------------------
// Layer 1 — Atomic fact
// ---------------------------------------------------------------------------

export interface FactChunk {
  type: 'fact';
  id: string;
  dtc?: string;
  make?: string;
  yearRange?: [number, number];
  content: string;
  confidence: number;
  confirmations: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Layer 2 — Conditional diagnostic pattern
// ---------------------------------------------------------------------------

export interface PatternCondition {
  // DTC codes that must ALL be active simultaneously
  dtcs?: string[];
  // Parameter thresholds — key is the OBD PID name (e.g. 'RPM', 'COOLANT_TEMP')
  params?: Record<string, { lt?: number; gt?: number }>;
  // Optional: ambient condition qualifier ('cold_start' | 'idle' | 'wot')
  qualifier?: 'cold_start' | 'idle' | 'wide_open_throttle';
}

export interface PatternChunk {
  type: 'pattern';
  id: string;
  condition: PatternCondition;
  conclusion: string;      // human-readable repair guidance
  scope?: {
    makes?: string[];      // e.g. ['VW', 'Audi', 'Seat']
    engines?: string[];    // e.g. ['EA288', 'EA189']
  };
  confidence: number;
  confirmations: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Layer 3 — SKOS ontology patch (proposed vocabulary addition)
// ---------------------------------------------------------------------------

export type SkosPatchOp =
  | 'addNarrower'   // add a new child concept under an existing concept
  | 'addRelated'    // add a cross-branch relation between two existing concepts
  | 'addDtcMapping' // map a DTC id to an existing concept

export interface SkosPatch {
  type: 'skos-patch';
  id: string;
  op: SkosPatchOp;
  // The existing concept this patch targets
  targetConceptId: string;
  // For addNarrower: new concept to create as a child
  newConcept?: { id: string; label: string };
  // For addRelated: the concept id to link as related
  relatedConceptId?: string;
  // For addDtcMapping: the DTC id to assign
  dtcId?: string;
  proposedBy: string;    // hash of the proposer feed key (no PII)
  confirmations: number; // how many peers approved this patch
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Layer 4 — Harvest case pair (PLAN-002 v2 C1, ADR-0002 corrections.jsonl)
// ---------------------------------------------------------------------------

// One validated diagnostic case: redacted brief → gate-checked senior answer
// (+ outcome when the user provided it). Flows on its OWN swarm topic
// (HARVEST_TOPIC) replicated only by the seed peer — never on the knowledge
// topic: peers get curated knowledge via the signed bundle (ADR-0002), not
// each other's raw cases (data minimization by construction).
//
// CONTRACT: the source of truth for this schema and the wire protocol is
// gazzimon/obdient-seed → PROTOCOL.md (OBDIENT-HARVEST/1). Keep in sync.
// The outcome is deliberately NOT part of the content hash: a re-append that
// adds the UX4 outcome days later keeps the same id and MERGES at ingest.
export interface CaseChunk {
  type: 'case';
  /** Schema version (PROTOCOL.md). Absent is treated as 1 by the hub. */
  v: 1;
  /** sha256 of (briefJson + seniorAnswer) — content-addressed dedup key. */
  id: string;
  /** Redacted DiagnosticBrief JSON — no VIN by construction (redact.ts). */
  brief: Record<string, unknown>;
  seniorAnswer: string;
  /** Verdict of the deterministic gate (diagnostic-gate.ts) at capture time.
   *  Only gate-passed cases should be contributed; the seed re-checks. */
  gate: {
    passed: boolean;
    violations: { rule: string; weight: 'hard' | 'soft'; detail: string }[];
  };
  /** UX4 outcome if the user had already answered when the case was contributed. */
  outcome?: 'yes' | 'no' | 'pending' | null;
  appVersion?: string;
  createdAt: string;
}

// Wire contract: DHT topic for case harvest (seed peer only). Padded to the
// 32-byte topic buffer by the transport, same convention as obdient-rag-v1.
export const HARVEST_TOPIC = 'obdient-harvest-v1';

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type DistributedChunk = FactChunk | PatternChunk | SkosPatch | CaseChunk;

// Type guards
export const isFactChunk    = (c: DistributedChunk): c is FactChunk    => c.type === 'fact';
export const isPatternChunk = (c: DistributedChunk): c is PatternChunk => c.type === 'pattern';
export const isSkosPatch    = (c: DistributedChunk): c is SkosPatch    => c.type === 'skos-patch';
export const isCaseChunk    = (c: DistributedChunk): c is CaseChunk    => c.type === 'case';

// Minimum confirmations required per layer before the chunk is acted upon
export const QUORUM = {
  fact:       3,   // 3 peers must confirm a DTC fix before surfacing in RAG
  pattern:    5,   // patterns need more evidence before influencing diagnosis
  skosPatch: 10,   // ontology changes are conservative — require strong consensus
} as const;
