// Structured audit log for on-device model lifecycle + inference performance.
//
// Each event is emitted as a single JSON line prefixed with the [AUDIT] tag so it
// can be grep-extracted from logcat into a clean .jsonl artifact:
//   adb logcat ... | Select-String '\[AUDIT\] '   →  scripts/extract-audit.ps1
//
// Captured events:
//   model_load   — modelId, src, load_ms
//   model_unload — modelId
//   inference    — modelId, prompt_chars, prompt_tokens_est, completion_tokens,
//                  ttft_ms (time-to-first-token), total_ms, tokens_per_sec
//
// This complements the human-readable [QVAC] log lines: those stay for quick visual
// scanning, while [AUDIT] gives a machine-parseable performance record per call.

const AUDIT_TAG = '[AUDIT]';

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
    };

// The QVAC SDK does not expose its tokenizer to JS, so prompt token counts are
// estimated at the common ~4 chars/token ratio. Marked "_est" in the record so
// consumers know it's an approximation, not an exact count.
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function audit(event: AuditEvent): void {
  const record = { ts: new Date().toISOString(), ...event };
  // Single-line JSON so each record is exactly one grep-able logcat entry.
  console.log(`${AUDIT_TAG} ${JSON.stringify(record)}`);
}
