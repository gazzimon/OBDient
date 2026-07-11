// CaseLogPort implementation (ADR-0009 Phase 3): append-only writes to the
// diagnosis & solutions case base. Fire-and-forget BY CONTRACT — persistence
// failures are logged and swallowed so the chat hot path never breaks on I/O.

import type { CaseLogPort, TurnRole } from '@/domain/usecases/diagnostic-intake-session';
import type { DiagnosticBrief } from '@/domain/entities/diagnostic-brief';
import type { GateResult } from '@/domain/services/diagnostic-gate';
import { audit } from '@/core/utils/audit-log';
import {
  insertBrief,
  insertConversationTurn,
  insertSymptomCandidate,
} from '@/data/datasources/storage.datasource';

export class CaseLogDataSource implements CaseLogPort {
  logTurn(sessionId: string, role: TurnRole, content: string, gate?: GateResult): void {
    // Instrument the gate verdict (N4) — the data layer is where importing the
    // audit sink is fine; the domain session stays pure. Only diagnosis turns
    // (junior/senior) carry a gate.
    if (gate && (role === 'junior' || role === 'senior')) {
      audit({
        event: 'gate',
        role,
        passed: gate.passed,
        hard: gate.violations.filter((v) => v.weight === 'hard').length,
        soft: gate.violations.filter((v) => v.weight === 'soft').length,
      });
    }
    insertConversationTurn({
      sessionId,
      role,
      content,
      createdAt: new Date(),
      // Verdict travels with the diagnosis turn (PLAN-002 v2 N2b) — C1 reads
      // it back when assembling CaseChunks for the harvest.
      gateJson: gate ? JSON.stringify(gate) : null,
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
