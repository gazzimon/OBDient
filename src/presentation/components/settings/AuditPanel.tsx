// Dev audit panel (PLAN-002 v2 N4) — renders the in-memory [AUDIT] ring buffer
// on-device, so model perf (TTFT / tok-s), gate verdicts and the gate pass rate
// are visible WITHOUT adb/logcat. Lives in Settings; refreshes live via the
// audit pub/sub.

import React, { useEffect, useReducer } from 'react';
import { View, Text, Pressable } from 'react-native';
import {
  getAuditRecords,
  auditSummary,
  subscribeAudit,
  clearAuditRecords,
  type AuditRecord,
} from '@/core/utils/audit-log';

const MINT = '#2DE1A5';
const AMBER = '#F5A623';
const MUTED = '#9A9A9A';

const MAX_ROWS = 12; // newest records shown; the buffer keeps more

function fmt(n: number | null, digits = 0): string {
  return n == null ? '—' : n.toFixed(digits);
}

// One-line summary of a record, typed by event.
function describe(r: AuditRecord): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  switch (r.event) {
    case 'inference':
      return {
        text: `inference · ${fmt(r.ttft_ms)}ms TTFT · ${fmt(r.tokens_per_sec, 1)} tok/s · ${r.completion_tokens} tok`,
        tone: 'muted',
      };
    case 'gate':
      return {
        text: `gate ${r.role} · ${r.passed ? 'passed' : `UNCONFIRMED (${r.hard} hard)`}`,
        tone: r.passed ? 'ok' : 'warn',
      };
    case 'model_load':
      return { text: `model load · ${r.load_ms}ms`, tone: 'muted' };
    case 'model_unload':
      return { text: 'model unload', tone: 'muted' };
  }
}

export function AuditPanel() {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeAudit(forceUpdate), []);

  const records = getAuditRecords();
  const s = auditSummary();
  const rate = s.gatePassRate == null ? '—' : `${Math.round(s.gatePassRate * 100)}%`;

  return (
    <View className="bg-brand-surface rounded-2xl p-4 mb-6">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-brand-text font-mono text-sm">Audit (dev)</Text>
        <Pressable onPress={clearAuditRecords} hitSlop={8} className="active:opacity-60">
          <Text className="font-mono text-xs" style={{ color: MUTED }}>clear</Text>
        </Pressable>
      </View>
      <Text className="text-brand-muted font-mono text-xs mb-3">
        On-device [AUDIT] ring — model perf + gate verdicts, no logcat needed
      </Text>

      {/* Aggregates */}
      <View className="flex-row gap-2 mb-3">
        <View className="flex-1 bg-brand-bg rounded-xl px-3 py-2">
          <Text className="text-brand-muted font-mono text-xs">avg TTFT</Text>
          <Text className="text-brand-text font-mono text-sm mt-0.5">{fmt(s.avgTtftMs)}ms</Text>
        </View>
        <View className="flex-1 bg-brand-bg rounded-xl px-3 py-2">
          <Text className="text-brand-muted font-mono text-xs">avg tok/s</Text>
          <Text className="text-brand-text font-mono text-sm mt-0.5">{fmt(s.avgTokensPerSec, 1)}</Text>
        </View>
        <View className="flex-1 bg-brand-bg rounded-xl px-3 py-2">
          <Text className="text-brand-muted font-mono text-xs">gate pass</Text>
          <Text className="font-mono text-sm mt-0.5" style={{ color: s.gatePassRate === 1 ? MINT : s.gateTotal > 0 ? AMBER : MUTED }}>
            {rate}
            {s.gateTotal > 0 ? ` (${s.gatePassed}/${s.gateTotal})` : ''}
          </Text>
        </View>
      </View>

      {/* Recent records */}
      {records.length === 0 ? (
        <Text className="text-brand-muted font-mono text-xs">
          No events yet — load the model and run a diagnosis.
        </Text>
      ) : (
        <View className="border-t border-brand-border pt-2">
          {records.slice(0, MAX_ROWS).map((r, i) => {
            const d = describe(r);
            const color = d.tone === 'ok' ? MINT : d.tone === 'warn' ? AMBER : MUTED;
            return (
              <Text key={i} className="font-mono text-[10px] leading-4" style={{ color }}>
                {r.ts.slice(11, 19)} {d.text}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}
