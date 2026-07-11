// Harvest outbox datasource (PLAN-002 v2 C1) — RN side of the Bare worklet
// that owns the device's append-only case feed (the feed IS the outbox).
//
// Fire-and-forget BY CONTRACT, like CaseLogPort: a dead worklet or a failed
// append must never break the chat hot path — failures are logged and the
// case is simply not contributed (it still lives in SQLite; a later backfill
// can recover it).
//
// Consent: gated on the `contributeCases` opt-in toggle (default OFF), checked
// at contribution time so flipping the switch needs no restart. Privacy: the
// brief is redacted by construction (no VIN — brief-assembler + redact.ts);
// the id recipe and gate re-check live in the worklet and the hub
// (obdient-seed/PROTOCOL.md).
//
// C2 (Fase B): the Bare runtime is now shared with the distributed-knowledge
// datasource via workletHost — this file just speaks the `ns:'harvest'` half of
// the IPC protocol.

import { useSettingsStore } from '@/store/settingsStore';
import { workletHost, type WorkletReply } from '@/data/datasources/worklet-host';
import {
  getLatestBriefBySession,
  getGatedSeniorTurn,
} from '@/data/datasources/storage.datasource';
import type { DiagnosticBrief } from '@/domain/entities/diagnostic-brief';
import type { GateResult } from '@/domain/services/diagnostic-gate';

export interface CaseContribution {
  readonly brief: DiagnosticBrief;
  readonly seniorAnswer: string;
  readonly gate: GateResult;
  readonly outcome?: 'yes' | 'no' | 'pending' | null;
}

export class HarvestOutboxDataSource {
  private openPromise: Promise<void> | null = null;

  // Open the persistent feed and join the harvest swarm (client) exactly once.
  // Storage dir is chosen by the worklet (bare-os homedir).
  private ensureOpened(): Promise<void> {
    if (this.openPromise !== null) return this.openPromise;

    this.openPromise = (async () => {
      const r = await workletHost.request('harvest', 'open', { swarm: true }, 'open');
      if (!r.ok) throw new Error((r.err as string) ?? 'open failed');
      console.log(`[Harvest] outbox feed ${String(r.key).slice(0, 16)}… (${r.length} blocks)`);
    })().catch((err) => {
      // Allow a later retry instead of caching the failure forever.
      this.openPromise = null;
      throw err;
    });

    return this.openPromise;
  }

  /** Fire-and-forget: append one validated case to the outbox feed.
   *  No-op unless the user opted into `contributeCases`. */
  contributeCase(c: CaseContribution): void {
    if (!useSettingsStore.getState().contributeCases) return;

    void (async () => {
      await this.ensureOpened();
      const r = await workletHost.request(
        'harvest',
        'appendCase',
        {
          brief: c.brief,
          seniorAnswer: c.seniorAnswer,
          gate: c.gate,
          outcome: c.outcome ?? null,
        },
        'append',
      );
      if (!r.ok) throw new Error((r.err as string) ?? 'append failed');
      console.log(`[Harvest] case ${String(r.id).slice(0, 12)}… appended (feed length ${r.length})`);
    })().catch((err) => console.warn('[Harvest] contribution failed:', err));
  }

  /** UX4 enrichment (fire-and-forget): re-contribute the session's case with
   *  its outcome. The id recipe hashes the SAME briefJson persisted at senior
   *  time, so the hub MERGES (outcome wins) instead of duplicating. */
  contributeOutcome(sessionId: string, outcome: 'yes' | 'no' | 'pending'): void {
    if (!useSettingsStore.getState().contributeCases) return;

    void (async () => {
      const brief = await getLatestBriefBySession(sessionId);
      const turn = await getGatedSeniorTurn(sessionId);
      if (brief == null || turn?.gateJson == null) return; // no senior case to enrich
      const gate = JSON.parse(turn.gateJson) as GateResult;
      if (gate.passed !== true) return; // the admission valve holds here too
      this.contributeCase({
        brief: JSON.parse(brief.briefJson) as DiagnosticBrief,
        seniorAnswer: turn.content,
        gate,
        outcome,
      });
    })().catch((err) => console.warn('[Harvest] outcome enrichment failed:', err));
  }

  /** Feed key/length/peer count — for a future Settings surface. */
  async status(): Promise<WorkletReply | null> {
    try {
      await this.ensureOpened();
      return await workletHost.request('harvest', 'status', {}, 'status');
    } catch {
      return null;
    }
  }
}

export const harvestOutbox = new HarvestOutboxDataSource();
