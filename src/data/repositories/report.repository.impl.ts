// Implements IReportRepository using the SQLite storage datasource.

import {
  insertSession,
  updateSession,
  getSessionById,
  listSessions,
  deleteSession,
  insertTroubleCode,
  getTroubleCodesBySession,
} from '@/data/datasources/storage.datasource';
import { mapTroubleCodeToRow, mapRowToTroubleCode } from '@/data/mappers/dtc.mapper';
import { SessionNotFoundError } from '@/core/errors/obd.errors';
import type { IReportRepository, ReportListItem } from '@/domain/repositories/i-report.repository';
import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';

export class ReportRepositoryImpl implements IReportRepository {
  async save(session: DiagnosticSession): Promise<void> {
    await insertSession({
      id: session.id,
      vehicleId: session.vehicleId,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? undefined,
      status: session.status,
      parametersJson: JSON.stringify(session.parameters),
      interpretation: session.interpretation ?? undefined,
    });

    for (const dtc of session.troubleCodes) {
      await insertTroubleCode(mapTroubleCodeToRow(dtc, session.id));
    }
  }

  async listSessions(limit = 50): Promise<ReportListItem[]> {
    const rows = await listSessions(limit);
    return Promise.all(
      rows.map(async (row) => {
        const dtcs = await getTroubleCodesBySession(row.id);
        return {
          id: row.id,
          vehicleId: row.vehicleId,
          startedAt: new Date(row.startedAt),
          endedAt: row.endedAt ? new Date(row.endedAt) : null,
          dtcCount: dtcs.length,
          hasInterpretation: row.interpretation != null,
        } satisfies ReportListItem;
      }),
    );
  }

  async getSessionById(id: string): Promise<DiagnosticSession | null> {
    const row = await getSessionById(id);
    if (!row) return null;

    const dtcRows = await getTroubleCodesBySession(id);

    return {
      id: row.id,
      vehicleId: row.vehicleId,
      startedAt: new Date(row.startedAt),
      endedAt: row.endedAt ? new Date(row.endedAt) : null,
      status: row.status,
      parameters: (() => {
        try {
          return JSON.parse(row.parametersJson) as DiagnosticSession['parameters'];
        } catch {
          return {} as DiagnosticSession['parameters'];
        }
      })(),
      troubleCodes: dtcRows.map(mapRowToTroubleCode),
      interpretation: row.interpretation ?? null,
    };
  }

  async deleteSession(id: string): Promise<void> {
    const existing = await getSessionById(id);
    if (!existing) throw new SessionNotFoundError(id);
    await deleteSession(id);
  }
}
