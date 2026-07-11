// Ring buffer + aggregates for the audit surface (PLAN-002 v2 N4).

import {
  audit,
  getAuditRecords,
  clearAuditRecords,
  subscribeAudit,
  auditSummary,
} from '@/core/utils/audit-log';

const inference = (over: Partial<Parameters<typeof audit>[0]> = {}) =>
  audit({
    event: 'inference',
    modelId: 'm',
    prompt_chars: 100,
    prompt_tokens_est: 25,
    completion_tokens: 40,
    ttft_ms: 200,
    total_ms: 1000,
    tokens_per_sec: 40,
    ...(over as object),
  } as Parameters<typeof audit>[0]);

beforeEach(() => clearAuditRecords());

describe('ring buffer', () => {
  it('stores records newest-first', () => {
    audit({ event: 'model_load', modelId: 'm', src: 'x', load_ms: 500 });
    inference();
    const recs = getAuditRecords();
    expect(recs).toHaveLength(2);
    expect(recs[0]?.event).toBe('inference'); // newest first
    expect(recs[1]?.event).toBe('model_load');
  });

  it('caps at 50 records', () => {
    for (let i = 0; i < 60; i++) inference();
    expect(getAuditRecords()).toHaveLength(50);
  });

  it('clear empties the buffer', () => {
    inference();
    clearAuditRecords();
    expect(getAuditRecords()).toHaveLength(0);
  });
});

describe('subscribe', () => {
  it('notifies on audit and stops after unsubscribe', () => {
    let n = 0;
    const off = subscribeAudit(() => { n++; });
    inference();
    expect(n).toBe(1);
    off();
    inference();
    expect(n).toBe(1); // no further notifications
  });
});

describe('auditSummary', () => {
  it('averages TTFT and tok/s over inference records only', () => {
    inference({ ttft_ms: 100, tokens_per_sec: 30 });
    inference({ ttft_ms: 300, tokens_per_sec: 50 });
    audit({ event: 'model_unload', modelId: 'm' }); // ignored by the averages
    const s = auditSummary();
    expect(s.inferences).toBe(2);
    expect(s.avgTtftMs).toBe(200);
    expect(s.avgTokensPerSec).toBe(40);
  });

  it('computes the gate pass rate', () => {
    audit({ event: 'gate', role: 'senior', passed: true, hard: 0, soft: 0 });
    audit({ event: 'gate', role: 'junior', passed: false, hard: 2, soft: 0 });
    audit({ event: 'gate', role: 'senior', passed: true, hard: 0, soft: 1 });
    const s = auditSummary();
    expect(s.gateTotal).toBe(3);
    expect(s.gatePassed).toBe(2);
    expect(s.gatePassRate).toBeCloseTo(2 / 3);
  });

  it('null rates when there is nothing to average', () => {
    const s = auditSummary();
    expect(s.avgTtftMs).toBeNull();
    expect(s.gatePassRate).toBeNull();
  });
});
