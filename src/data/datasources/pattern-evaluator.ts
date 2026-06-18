// Evaluates Layer 2 PatternChunks against a live OBD snapshot.
//
// A pattern matches when ALL of the following are true:
//   - Every DTC listed in condition.dtcs is present in the active trouble codes
//   - Every parameter threshold in condition.params is satisfied
//   - The vehicle make (if provided) matches the pattern's scope
//
// Matched pattern conclusions are injected into the RAG context alongside
// regular knowledge snippets, so the LLM receives them as grounding context.

import type { PatternChunk, PatternCondition } from '@/data/knowledge/distributed-chunk';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface PatternMatch {
  pattern: PatternChunk;
  conclusion: string;
}

function evaluateCondition(
  condition: PatternCondition,
  activeDtcs: readonly TroubleCode[],
  parameters: ObdParameterSnapshot,
): boolean {
  // All required DTCs must be active
  if (condition.dtcs && condition.dtcs.length > 0) {
    const activeCodes = new Set(activeDtcs.map((d) => d.code));
    if (!condition.dtcs.every((d) => activeCodes.has(d))) return false;
  }

  // All parameter thresholds must be satisfied
  if (condition.params) {
    for (const [pid, threshold] of Object.entries(condition.params)) {
      const param = (parameters as Record<string, typeof parameters[keyof typeof parameters]>)[pid];
      if (param?.value == null) continue; // missing param → skip threshold check
      const val = Number(param.value);
      if (threshold.lt != null && val >= threshold.lt) return false;
      if (threshold.gt != null && val <= threshold.gt) return false;
    }
  }

  return true;
}

export function evaluatePatterns(
  patterns: PatternChunk[],
  activeDtcs: readonly TroubleCode[],
  parameters: ObdParameterSnapshot,
  vehicleMake?: string,
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  for (const pattern of patterns) {
    // Scope check: if the pattern declares makes, the vehicle must be in the list
    if (pattern.scope?.makes && vehicleMake) {
      const makeLower = vehicleMake.toLowerCase();
      const inScope = pattern.scope.makes.some((m) => m.toLowerCase() === makeLower);
      if (!inScope) continue;
    }

    if (evaluateCondition(pattern.condition, activeDtcs, parameters)) {
      matches.push({ pattern, conclusion: pattern.conclusion });
    }
  }

  // Sort by confidence descending so the strongest patterns appear first
  return matches.sort((a, b) => b.pattern.confidence - a.pattern.confidence);
}
