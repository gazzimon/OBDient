// Deterministic one-line summary of a diagnostic session — a short, scannable
// header for the Reports list (≤ SUMMARY_MAX chars). Zero tokens: it is built
// from the session's DTCs and the owner's own symptom mentions, never the model.
// Reuses the same deterministic symptom matcher the intake uses.
//
// Stored in the (repurposed) `interpretation` column: the old full AI
// interpretation is gone, so that column now carries this header instead.

import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';
import { matchSymptomsDetailed } from '@/domain/services/symptom-matcher';
import { SYMPTOM_MAP } from '@/data/knowledge/symptom-ontology';

export const SUMMARY_MAX = 30;

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Builds the Reports header. Preference order:
 *   1. "DTC · symptom" — only when both fit within SUMMARY_MAX (no ugly cut).
 *   2. DTC code alone (kept intact; "+N" when several codes).
 *   3. The matched symptom label (truncated if long).
 *   4. The owner's first message, truncated.
 *   5. '—' for an empty session.
 */
export function buildSessionSummary(session: DiagnosticSession): string {
  const dtcs = session.troubleCodes;
  const primary = dtcs[0]?.code;
  const dtcPart =
    primary != null
      ? dtcs.length > 1
        ? `${primary} +${dtcs.length - 1}`
        : primary
      : undefined;

  // Symptom from the owner's own words — deterministic keyword match, so it
  // skips greetings and identity answers. First confirmed symptom wins.
  const ownerText = session.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('. ');
  const symptomId = matchSymptomsDetailed(ownerText).confirmed[0];
  const symptomLabel = symptomId != null ? SYMPTOM_MAP[symptomId]?.label : undefined;

  if (dtcPart != null && symptomLabel != null) {
    const both = `${dtcPart} · ${symptomLabel}`;
    if (both.length <= SUMMARY_MAX) return both;
  }
  if (dtcPart != null) return dtcPart;
  if (symptomLabel != null) return truncate(symptomLabel, SUMMARY_MAX);

  const firstOwnerLine = session.messages.find((m) => m.role === 'user')?.content;
  return firstOwnerLine != null && firstOwnerLine.trim().length > 0
    ? truncate(firstOwnerLine, SUMMARY_MAX)
    : '—';
}
