// Tests for trust-registry.ts — peer reputation scoring and gating.

// Mock MMKV so no native module is needed in the test environment.
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: jest.fn().mockReturnValue(null),
    set: jest.fn(),
  }),
}));

import {
  TrustRegistry,
  MIN_TRUST_SCORE,
  HIGH_TRUST_SCORE,
} from '@/data/datasources/trust-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshRegistry(): TrustRegistry {
  return new TrustRegistry();
}

const PEER_A = 'aabbccdd00001111';
const PEER_B = 'bbccddee11112222';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('TrustRegistry — initial state', () => {
  it('returns INITIAL_SCORE (0.3) for an unknown peer', () => {
    const reg = freshRegistry();
    expect(reg.scoreFor('unknown-peer')).toBe(0.3);
  });

  it('treats unknown peers as trusted (0.3 >= MIN_TRUST_SCORE)', () => {
    const reg = freshRegistry();
    expect(reg.isTrusted('unknown-peer')).toBe(true);
  });

  it('returns empty allPeers() on a fresh registry', () => {
    const reg = freshRegistry();
    expect(reg.allPeers()).toHaveLength(0);
  });

  it('returns zero stats on a fresh registry', () => {
    const reg = freshRegistry();
    expect(reg.stats()).toEqual({ total: 0, trusted: 0, silenced: 0 });
  });
});

// ---------------------------------------------------------------------------
// recordConfirmation — positive signal
// ---------------------------------------------------------------------------

describe('TrustRegistry — recordConfirmation', () => {
  it('raises score toward 1 on each confirmation', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    const before = reg.scoreFor(PEER_A); // 0.3

    reg.recordConfirmation(PEER_A);
    expect(reg.scoreFor(PEER_A)).toBeGreaterThan(before);
  });

  it('applies dampened update: score += 0.1 * (1 - score)', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    // score starts at 0.3 after recordPublication
    reg.recordConfirmation(PEER_A);
    // 0.3 + 0.1 * (1 - 0.3) = 0.3 + 0.07 = 0.37
    expect(reg.scoreFor(PEER_A)).toBeCloseTo(0.37, 5);
  });

  it('never exceeds 1.0 after many confirmations', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 500; i++) reg.recordConfirmation(PEER_A);
    expect(reg.scoreFor(PEER_A)).toBeLessThanOrEqual(1.0);
  });

  it('increments confirmed counter', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    reg.recordConfirmation(PEER_A);
    reg.recordConfirmation(PEER_A);
    const peer = reg.allPeers().find((p) => p.peerId === PEER_A);
    expect(peer?.confirmed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// recordRejection — negative signal
// ---------------------------------------------------------------------------

describe('TrustRegistry — recordRejection', () => {
  it('lowers score toward 0 on each rejection', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    const before = reg.scoreFor(PEER_A);

    reg.recordRejection(PEER_A);
    expect(reg.scoreFor(PEER_A)).toBeLessThan(before);
  });

  it('applies dampened update: score += 0.1 * (0 - score)', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    reg.recordRejection(PEER_A);
    // 0.3 + 0.1 * (0 - 0.3) = 0.3 - 0.03 = 0.27
    expect(reg.scoreFor(PEER_A)).toBeCloseTo(0.27, 5);
  });

  it('eventually silences a peer with repeated rejections', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 50; i++) reg.recordRejection(PEER_A);
    expect(reg.isTrusted(PEER_A)).toBe(false);
    expect(reg.scoreFor(PEER_A)).toBeLessThan(MIN_TRUST_SCORE);
  });

  it('increments rejected counter', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    reg.recordRejection(PEER_A);
    const peer = reg.allPeers().find((p) => p.peerId === PEER_A);
    expect(peer?.rejected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isTrusted gating
// ---------------------------------------------------------------------------

describe('TrustRegistry — isTrusted', () => {
  it('trusts a peer that has been confirmed many times', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 30; i++) reg.recordConfirmation(PEER_A);
    expect(reg.isTrusted(PEER_A)).toBe(true);
    expect(reg.scoreFor(PEER_A)).toBeGreaterThan(HIGH_TRUST_SCORE);
  });

  it('silences a peer below MIN_TRUST_SCORE', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 50; i++) reg.recordRejection(PEER_A);
    expect(reg.isTrusted(PEER_A)).toBe(false);
  });

  it('keeps two peers independent', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    reg.recordPublication(PEER_B);
    for (let i = 0; i < 50; i++) reg.recordRejection(PEER_A);
    for (let i = 0; i < 20; i++) reg.recordConfirmation(PEER_B);

    expect(reg.isTrusted(PEER_A)).toBe(false);
    expect(reg.isTrusted(PEER_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// weightedConfidence
// ---------------------------------------------------------------------------

describe('TrustRegistry — weightedConfidence', () => {
  it('gives full multiplier to a high-trust peer', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 60; i++) reg.recordConfirmation(PEER_A);
    // Score near 1 → multiplier near 1.0 → weighted ≈ base
    const weighted = reg.weightedConfidence(0.8, PEER_A);
    expect(weighted).toBeGreaterThan(0.75);
  });

  it('discounts confidence for a low-trust peer', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 30; i++) reg.recordRejection(PEER_A);
    // Score near 0 → multiplier near 0.5
    const weighted = reg.weightedConfidence(0.8, PEER_A);
    expect(weighted).toBeLessThan(0.5);
  });

  it('applies multiplier lerp(0.5, 1.0, score) to an unknown peer', () => {
    const reg = freshRegistry();
    // score = 0.3 → multiplier = 0.5 + 0.5 * 0.3 = 0.65
    const weighted = reg.weightedConfidence(0.8, 'unknown-peer');
    expect(weighted).toBeCloseTo(0.8 * 0.65, 4);
  });

  it('never exceeds 0.99', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    for (let i = 0; i < 500; i++) reg.recordConfirmation(PEER_A);
    expect(reg.weightedConfidence(1.0, PEER_A)).toBeLessThanOrEqual(0.99);
  });
});

// ---------------------------------------------------------------------------
// stats()
// ---------------------------------------------------------------------------

describe('TrustRegistry — stats', () => {
  it('counts total, trusted and silenced peers correctly', () => {
    const reg = freshRegistry();
    reg.recordPublication(PEER_A);
    reg.recordPublication(PEER_B);

    for (let i = 0; i < 50; i++) reg.recordRejection(PEER_A);

    const stats = reg.stats();
    expect(stats.total).toBe(2);
    expect(stats.trusted).toBe(1);
    expect(stats.silenced).toBe(1);
  });
});
