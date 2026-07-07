// InterviewerPort adapter over the on-device model (ADR-0009 §1).
// CARpsy only picks the WORDS of the next intake question; the deterministic
// checklist already decided WHAT is missing. Any failure here degrades to the
// use case's fixed templates, so this path may fail freely.

import type { InterviewerPort } from '@/domain/usecases/diagnostic-intake-session';
import type { MissingField } from '@/domain/entities/diagnostic-brief';
import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';

const FIELD_HINTS: Readonly<Record<MissingField, string>> = {
  make: 'vehicle make (brand)',
  model: 'vehicle model',
  year: 'model year',
  obd_evidence: 'OBD data — ask them to connect the adapter and read codes or live data',
};

export class QvacInterviewerAdapter implements InterviewerPort {
  async phraseQuestion(
    missing: readonly MissingField[],
    knownSummary: string,
  ): Promise<string> {
    const context =
      'INTAKE MODE. You are collecting basic case data from a vehicle owner ' +
      'before a senior technician takes over the diagnosis. ' +
      `Known so far: ${knownSummary.length > 0 ? knownSummary : 'nothing yet'}. ` +
      `Still missing: ${missing.map((m) => FIELD_HINTS[m]).join('; ')}.`;

    const result = await qvacSDK.chat(context, [
      {
        role: 'user',
        content:
          'Ask me ONE short, friendly question to obtain the missing data. ' +
          'Reply with the question only — no preamble, no explanation.',
      },
    ]);
    return result.text;
  }
}

export const qvacInterviewer = new QvacInterviewerAdapter();
