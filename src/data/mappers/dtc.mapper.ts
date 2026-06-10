// Maps raw ELM327 mode-03 response to TroubleCode domain entities.

import { parseDtcResponse } from '@/core/utils/dtcParser';
import { createTroubleCode } from '@/domain/entities/trouble-code';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { TroubleCodeRow } from '@/data/db/schema';

export function mapRawResponseToTroubleCodes(rawResponse: string): TroubleCode[] {
  const parsed = parseDtcResponse(rawResponse);
  return parsed.map((p) =>
    createTroubleCode(p.code, p.system, p.description, p.severity),
  );
}

// Maps a database row back to a TroubleCode domain entity
export function mapRowToTroubleCode(row: TroubleCodeRow): TroubleCode {
  return {
    id: row.id,
    code: row.code,
    system: row.system,
    description: row.description,
    severity: row.severity,
    detectedAt: new Date(row.detectedAt),
    interpretation: row.interpretation ?? null,
  };
}

// Maps a TroubleCode entity to a database row for persistence
export function mapTroubleCodeToRow(
  dtc: TroubleCode,
  sessionId: string,
): TroubleCodeRow {
  return {
    id: dtc.id,
    sessionId,
    code: dtc.code,
    system: dtc.system,
    description: dtc.description,
    severity: dtc.severity,
    detectedAt: dtc.detectedAt,
    interpretation: dtc.interpretation,
  };
}
