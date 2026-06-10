// Contract for persisting and querying diagnostic sessions in local storage.

import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';

export interface ReportListItem {
  readonly id: string;
  readonly vehicleId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly dtcCount: number;
  readonly hasInterpretation: boolean;
}

export interface IReportRepository {
  // Persists a completed diagnostic session.
  save(session: DiagnosticSession): Promise<void>;

  // Returns a lightweight list for the reports screen (no full parameter data).
  listSessions(limit?: number): Promise<ReportListItem[]>;

  // Returns the full session by id, or null if not found.
  getSessionById(id: string): Promise<DiagnosticSession | null>;

  // Permanently removes a session.
  deleteSession(id: string): Promise<void>;
}
