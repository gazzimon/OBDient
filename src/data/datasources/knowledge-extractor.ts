// Extracts anonymous diagnostic knowledge chunks from completed sessions.
//
// Called at the end of a diagnostic session when the user has opted in to
// contributing knowledge. Raw session data is anonymised before contributing
// to the Hypercore feed: no VIN, no Bluetooth address, no user identifier.
//
// A chunk is only generated when the session has at least one active DTC,
// otherwise there is nothing diagnostically interesting to share.

import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';
import type { KnowledgeChunk } from './hypercore-knowledge.datasource';
import { hypercoreKnowledge } from './hypercore-knowledge.datasource';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// Build a human-readable content string from a session — no PII included.
function buildContent(session: DiagnosticSession): string {
  const lines: string[] = [];

  for (const dtc of session.troubleCodes) {
    lines.push(`DTC ${dtc.code} (${dtc.severity}): ${dtc.description}`);
  }

  const params = session.parameters;
  if (params.rpm != null) lines.push(`RPM: ${params.rpm}`);
  if (params.coolantTemp != null) lines.push(`Coolant temp: ${params.coolantTemp}°C`);
  if (params.engineLoad != null) lines.push(`Engine load: ${params.engineLoad}%`);

  if (session.interpretation) {
    lines.push(`Assessment: ${session.interpretation}`);
  }

  return lines.join('\n');
}

export async function extractAndContribute(
  session: DiagnosticSession,
  opts: { contributeEnabled: boolean },
): Promise<void> {
  if (!opts.contributeEnabled) return;
  if (!hypercoreKnowledge.isReady()) return;
  if (session.troubleCodes.length === 0) return;

  const primaryDtc = session.troubleCodes[0];
  const content = buildContent(session);
  if (!content.trim()) return;

  const chunk: KnowledgeChunk = {
    id: generateId(),
    dtc: primaryDtc.code,
    content,
    confidence: 0.5,
    confirmations: 1,
    createdAt: new Date().toISOString(),
  };

  await hypercoreKnowledge.contribute(chunk);
}
