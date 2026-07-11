// Persists a completed diagnostic session to local SQLite storage.

import type { IReportRepository } from '@/domain/repositories/i-report.repository';
import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import { buildSessionSummary } from '@/domain/services/session-summary';

export interface SaveDiagnosticReportInput {
  session: DiagnosticSession;
  // Allows updating the snapshot before saving (final state may differ from session.parameters)
  finalParameters?: ObdParameterSnapshot;
  finalTroubleCodes?: readonly TroubleCode[];
}

export class SaveDiagnosticReportUseCase {
  constructor(private readonly reportRepo: IReportRepository) {}

  async execute(input: SaveDiagnosticReportInput): Promise<void> {
    const base: DiagnosticSession = {
      ...input.session,
      endedAt: input.session.endedAt ?? new Date(),
      status: input.session.status === 'active' ? 'completed' : input.session.status,
      parameters: input.finalParameters ?? input.session.parameters,
      troubleCodes: input.finalTroubleCodes ?? input.session.troubleCodes,
    };

    const toSave: DiagnosticSession = {
      ...base,
      // The `interpretation` column now holds a short, deterministic Reports
      // header (≤ SUMMARY_MAX chars) built from the DTCs + the owner's symptoms.
      interpretation: buildSessionSummary(base),
    };

    await this.reportRepo.save(toSave);
  }
}
