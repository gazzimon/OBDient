// CaseLogPort implementation (ADR-0009 Phase 3): append-only writes to the
// diagnosis & solutions case base. Fire-and-forget BY CONTRACT — persistence
// failures are logged and swallowed so the chat hot path never breaks on I/O.

import type { CaseLogPort, TurnRole } from '@/domain/usecases/diagnostic-intake-session';
import type { DiagnosticBrief } from '@/domain/entities/diagnostic-brief';
import {
  insertBrief,
  insertConversationTurn,
  insertSymptomCandidate,
} from '@/data/datasources/storage.datasource';

export class CaseLogDataSource implements CaseLogPort {
  logTurn(sessionId: string, role: TurnRole, content: string): void {
    insertConversationTurn({
      sessionId,
      role,
      content,
      createdAt: new Date(),
    }).catch((err) => console.warn('[CaseLog] turn write failed:', err));
  }

  logSymptomCandidate(sessionId: string, description: string): void {
    insertSymptomCandidate({
      sessionId,
      description,
      createdAt: new Date(),
    }).catch((err) => console.warn('[CaseLog] symptom candidate write failed:', err));
  }

  logBrief(sessionId: string, brief: DiagnosticBrief, prompt: string): void {
    insertBrief({
      id: `${sessionId}-${brief.createdAt}`,
      sessionId,
      createdAt: new Date(brief.createdAt),
      briefJson: JSON.stringify(brief),
      prompt,
    }).catch((err) => console.warn('[CaseLog] brief write failed:', err));
  }
}

export const caseLog = new CaseLogDataSource();
