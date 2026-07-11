// Contract for persisting and querying diagnostic sessions in local storage.

import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';

// Tap-only case outcome (ADR-0004 Phase 0). `resolved` is the ground-truth
// signal; `rootCause` is a chip label the user tapped, never free text.
export type OutcomeResolved = 'yes' | 'no' | 'pending';

export interface CaseOutcome {
  readonly resolved: OutcomeResolved;
  readonly rootCause: string | null;
}

export interface ReportListItem {
  readonly id: string;
  readonly vehicleId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly dtcCount: number;
  readonly messageCount: number;
  // Short deterministic header for the list card (stored in the `interpretation`
  // column). null on legacy rows saved before summaries existed.
  readonly summary: string | null;
  // Deterministic candidate causes (DTC fault-class labels) offered as chips —
  // empty when the case has no mapped DTCs.
  readonly causeChips: readonly string[];
  // Current outcome, or null if the user hasn't answered yet.
  readonly outcome: CaseOutcome | null;
}

export interface IReportRepository {
  // Persists a completed diagnostic session.
  save(session: DiagnosticSession): Promise<void>;

  // Returns a lightweight list for the reports screen (no full parameter data).
  listSessions(limit?: number): Promise<ReportListItem[]>;

  // Returns the full session by id, or null if not found.
  getSessionById(id: string): Promise<DiagnosticSession | null>;

  // Upserts the tap-only case outcome (one row per session).
  saveOutcome(sessionId: string, outcome: CaseOutcome): Promise<void>;

  // Permanently removes a session.
  deleteSession(id: string): Promise<void>;
}
