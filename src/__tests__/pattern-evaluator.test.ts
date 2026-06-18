// Tests for pattern-evaluator.ts — LayerChunk condition evaluation.

import { evaluatePatterns } from '@/data/datasources/pattern-evaluator';
import type { PatternChunk } from '@/data/knowledge/distributed-chunk';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePattern(overrides: Partial<PatternChunk> = {}): PatternChunk {
  return {
    type: 'pattern',
    id: 'test-pattern-1',
    condition: { dtcs: ['P0299'] },
    conclusion: 'Check turbo actuator before replacing turbo',
    confidence: 0.8,
    confirmations: 5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDtc(code: string): TroubleCode {
  return {
    id: `${code}-1`,
    code,
    system: 'P',
    description: `Test DTC ${code}`,
    severity: 'warning',
    detectedAt: new Date(),
    interpretation: null,
  };
}

// ---------------------------------------------------------------------------
// Basic matching
// ---------------------------------------------------------------------------

describe('evaluatePatterns — basic', () => {
  it('matches when required DTC is active', () => {
    const results = evaluatePatterns(
      [makePattern({ condition: { dtcs: ['P0299'] } })],
      [makeDtc('P0299')],
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.conclusion).toBe('Check turbo actuator before replacing turbo');
  });

  it('does not match when required DTC is absent', () => {
    const results = evaluatePatterns(
      [makePattern({ condition: { dtcs: ['P0299'] } })],
      [makeDtc('P0300')],
      {},
    );
    expect(results).toHaveLength(0);
  });

  it('matches only when ALL required DTCs are active simultaneously', () => {
    const pattern = makePattern({ condition: { dtcs: ['P0299', 'P0234'] } });

    // Only one of two required
    expect(evaluatePatterns([pattern], [makeDtc('P0299')], {})).toHaveLength(0);

    // Both present
    expect(
      evaluatePatterns([pattern], [makeDtc('P0299'), makeDtc('P0234')], {}),
    ).toHaveLength(1);
  });

  it('returns empty array when patterns list is empty', () => {
    expect(evaluatePatterns([], [makeDtc('P0300')], {})).toHaveLength(0);
  });

  it('returns empty array when no active DTCs and condition requires some', () => {
    expect(evaluatePatterns([makePattern()], [], {})).toHaveLength(0);
  });

  it('matches a pattern with no DTC condition (always evaluates params only)', () => {
    const pattern = makePattern({ condition: {} });
    const results = evaluatePatterns([pattern], [], {});
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Parameter threshold evaluation
// ---------------------------------------------------------------------------

describe('evaluatePatterns — parameter thresholds', () => {
  const snapshot: ObdParameterSnapshot = {
    RPM: { name: 'RPM', value: 1800, unit: 'rpm', alert: null } as any,
    COOLANT_TEMP: { name: 'COOLANT_TEMP', value: 95, unit: '°C', alert: null } as any,
  };

  it('matches when param is below the lt threshold', () => {
    const pattern = makePattern({
      condition: { params: { RPM: { lt: 2000 } } },
    });
    expect(evaluatePatterns([pattern], [], snapshot)).toHaveLength(1);
  });

  it('does not match when param is above the lt threshold', () => {
    const pattern = makePattern({
      condition: { params: { RPM: { lt: 1000 } } },
    });
    expect(evaluatePatterns([pattern], [], snapshot)).toHaveLength(0);
  });

  it('matches when param is above the gt threshold', () => {
    const pattern = makePattern({
      condition: { params: { COOLANT_TEMP: { gt: 90 } } },
    });
    expect(evaluatePatterns([pattern], [], snapshot)).toHaveLength(1);
  });

  it('does not match when param is below the gt threshold', () => {
    const pattern = makePattern({
      condition: { params: { COOLANT_TEMP: { gt: 100 } } },
    });
    expect(evaluatePatterns([pattern], [], snapshot)).toHaveLength(0);
  });

  it('skips threshold check for missing params (does not block match)', () => {
    const pattern = makePattern({
      condition: { params: { ENGINE_LOAD: { lt: 50 } } }, // not in snapshot
    });
    expect(evaluatePatterns([pattern], [], snapshot)).toHaveLength(1);
  });

  it('evaluates combined DTC + param condition correctly', () => {
    const pattern = makePattern({
      condition: {
        dtcs: ['P0299'],
        params: { RPM: { lt: 2000 } },
      },
    });

    // DTC present + RPM in range → match
    expect(
      evaluatePatterns([pattern], [makeDtc('P0299')], snapshot),
    ).toHaveLength(1);

    // DTC present but RPM too high
    const highRpm: ObdParameterSnapshot = {
      RPM: { name: 'RPM', value: 3000, unit: 'rpm', alert: null } as any,
    };
    expect(
      evaluatePatterns([pattern], [makeDtc('P0299')], highRpm),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scope filtering by vehicle make
// ---------------------------------------------------------------------------

describe('evaluatePatterns — scope', () => {
    // No DTC condition so scope is the only filter under test
  const vwPattern = makePattern({
    condition: {},
    scope: { makes: ['VW', 'Audi', 'Seat'] },
  });

  it('matches when vehicle make is in scope', () => {
    expect(evaluatePatterns([vwPattern], [], {}, 'VW')).toHaveLength(1);
    expect(evaluatePatterns([vwPattern], [], {}, 'Audi')).toHaveLength(1);
  });

  it('does not match when vehicle make is outside scope', () => {
    expect(evaluatePatterns([vwPattern], [], {}, 'Toyota')).toHaveLength(0);
  });

  it('is case-insensitive for make comparison', () => {
    expect(evaluatePatterns([vwPattern], [], {}, 'vw')).toHaveLength(1);
    expect(evaluatePatterns([vwPattern], [], {}, 'AUDI')).toHaveLength(1);
  });

  it('matches when no vehicle make is provided and scope is set', () => {
    // Unknown make — we don't filter out, we let it through
    expect(evaluatePatterns([vwPattern], [], {})).toHaveLength(1);
  });

  it('matches a pattern with no scope for any make', () => {
    const unscoped = makePattern({ condition: {} }); // no scope, no DTC condition
    expect(evaluatePatterns([unscoped], [], {}, 'Toyota')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('evaluatePatterns — result ordering', () => {
  it('returns matches sorted by confidence descending', () => {
    // All use empty condition so they all match without needing active DTCs
    const low  = makePattern({ id: 'low',  confidence: 0.4, condition: {} });
    const high = makePattern({ id: 'high', confidence: 0.9, condition: {} });
    const mid  = makePattern({ id: 'mid',  confidence: 0.6, condition: {} });

    const results = evaluatePatterns([low, high, mid], [], {});
    expect(results[0]?.pattern.confidence).toBe(0.9);
    expect(results[1]?.pattern.confidence).toBe(0.6);
    expect(results[2]?.pattern.confidence).toBe(0.4);
  });
});
