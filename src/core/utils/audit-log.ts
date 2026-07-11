// Structured audit log for on-device model lifecycle + inference performance +
// deterministic-gate verdicts (PLAN-002 v2 N4).
//
// Two sinks, one call:
//   1. console.log JSONL — each event is a single [AUDIT]-tagged line, so it
//      can be grep-extracted from logcat into a clean artifact:
//        adb logcat ... | Select-String '\[AUDIT\] '   →  scripts/extract-audit.ps1
//   2. In-memory ring buffer — the last N records, so an on-device dev panel
//      (Settings) can render TTFT / tok-s / gate verdicts WITHOUT adb/logcat.
//
// Captured events:
//   model_load   — modelId, src, load_ms
//   model_unload — modelId
//   inference    — modelId, prompt_chars, prompt_tokens_est, completion_tokens,
//                  ttft_ms (time-to-first-token), total_ms, tokens_per_sec
//   gate         — role (junior|senior), passed, hard, soft (violation counts)

const AUDIT_TAG = '[AUDIT]';

// Ring buffer size — enough history for a dev panel, bounded so a long session
// can never grow memory without limit.
const MAX_RECORDS = 50;

export type AuditEvent =
  | { event: 'model_load'; modelId: string; src: string; load_ms: number }
  | { event: 'model_unload'; modelId: string }
  | {
      event: 'inference';
      modelId: string;
      prompt_chars: number;
      prompt_tokens_est: number;
      completion_tokens: number;
      ttft_ms: number | null;
      total_ms: number;
      tokens_per_sec: number;
    }
  | {
      event: 'gate';
      role: 'junior' | 'senior';
      passed: boolean;
      hard: number; // hard violation count
      soft: number; // soft violation count
    };

export type AuditRecord = AuditEvent & { ts: string };

// The QVAC SDK does not expose its tokenizer to JS, so prompt token counts are
// estimated at the common ~4 chars/token ratio. Marked "_est" in the record so
// consumers know it's an approximation, not an exact count.
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

// Newest-first ring buffer + a tiny pub/sub so the panel can refresh live.
let records: AuditRecord[] = [];
const listeners = new Set<() => void>();

export function audit(event: AuditEvent): void {
  const record: AuditRecord = { ts: new Date().toISOString(), ...event };

  // Sink 1 — single-line JSON, exactly one grep-able logcat entry.
  console.log(`${AUDIT_TAG} ${JSON.stringify(record)}`);

  // Sink 2 — in-memory ring (newest first, capped).
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  for (const notify of listeners) notify();
}

/** Snapshot of the ring buffer, newest first. */
export function getAuditRecords(): readonly AuditRecord[] {
  return records;
}

export function clearAuditRecords(): void {
  records = [];
  for (const notify of listeners) notify();
}

/** Subscribe to buffer changes (dev panel). Returns an unsubscribe fn. */
export function subscribeAudit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── Aggregates for the dev panel ─────────────────────────────────────────────

export interface AuditSummary {
  inferences: number;
  avgTtftMs: number | null;
  avgTokensPerSec: number | null;
  gateTotal: number;
  gatePassed: number;
  gatePassRate: number | null; // 0..1, null when no gate records yet
}

export function auditSummary(): AuditSummary {
  const inf = records.filter((r): r is AuditRecord & { event: 'inference' } => r.event === 'inference');
  const gates = records.filter((r): r is AuditRecord & { event: 'gate' } => r.event === 'gate');
  const ttfts = inf.map((r) => r.ttft_ms).filter((v): v is number => v != null);
  const passed = gates.filter((g) => g.passed).length;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    inferences: inf.length,
    avgTtftMs: avg(ttfts),
    avgTokensPerSec: avg(inf.map((r) => r.tokens_per_sec)),
    gateTotal: gates.length,
    gatePassed: passed,
    gatePassRate: gates.length ? passed / gates.length : null,
  };
}
