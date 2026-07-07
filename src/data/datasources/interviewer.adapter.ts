// InterviewerPort adapter over the on-device model (ADR-0009 §1).
// CARpsy only picks the WORDS of the next intake question; the deterministic
// checklist already decided WHAT is missing. Any failure here degrades to the
// use case's fixed templates, so this path may fail freely.

import type { InterviewerPort, IntakeGap } from '@/domain/usecases/diagnostic-intake-session';
import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';

const FIELD_HINTS: Readonly<Record<IntakeGap, string>> = {
  make: 'vehicle make (brand)',
  model: 'vehicle model',
  year: 'model year',
  obd_evidence: 'OBD data — ask them to connect the adapter and read codes or live data',
  symptoms: 'the symptoms the owner notices (noises, smells, smoke, behavior cold vs hot)',
  details: 'when the problem started and under what conditions (cold start, warmed up, idle, accelerating), plus recent repairs',
};

export class QvacInterviewerAdapter implements InterviewerPort {
  async phraseQuestion(
    missing: readonly IntakeGap[],
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
