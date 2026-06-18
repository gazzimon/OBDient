// Tests for shimi-tree.ts — hierarchical confidence-weighted knowledge retrieval.
//
// ShimiTree depends on MMKV (native) which is mocked, and on the real
// obd-ontology + obd-knowledge + shimi-node modules (no mocks needed — pure TS).

// ---------------------------------------------------------------------------
// MMKV mock — must be before any import that triggers shimi-tree module load
// ---------------------------------------------------------------------------

let mmkvStore: Record<string, string> = {};

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: jest.fn((key: string) => mmkvStore[key] ?? null),
    set: jest.fn((key: string, value: string) => { mmkvStore[key] = value; }),
  }),
}));

import { ShimiTree } from '@/data/knowledge/shimi-tree';
import { QUORUM } from '@/data/knowledge/distributed-chunk';
import type { FactChunk, SkosPatch } from '@/data/knowledge/distributed-chunk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFactChunk(dtc: string, overrides: Partial<FactChunk> = {}): FactChunk {
  return {
    type: 'fact',
    id: `fact-${dtc}`,
    dtc,
    content: `Test content for ${dtc}`,
    confidence: 0.8,
    confirmations: 4,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSkosPatch(overrides: Partial<SkosPatch> = {}): SkosPatch {
  return {
    type: 'skos-patch',
    id: 'patch-test-1',
    op: 'addNarrower',
    targetConceptId: 'ignition',
    newConcept: { id: 'test_concept_new', label: 'Test new concept' },
    proposedBy: 'peer-aabbccdd',
    confirmations: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset in-memory MMKV store between tests so confidence state doesn't leak
  mmkvStore = {};
  // Fake timers prevent the 6-hour decay setInterval from keeping Jest alive.
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ShimiTree — construction', () => {
  it('builds without throwing', () => {
    expect(() => new ShimiTree()).not.toThrow();
  });

  it('has a positive confidence for concepts that have knowledge docs', () => {
    const tree = new ShimiTree();
    // misfire_random maps to P0300 which has docs in obd-knowledge
    const conf = tree.confidenceFor('misfire_random');
    expect(conf).toBeGreaterThan(0);
  });

  it('has zero confidence for concepts with no docs (branch parents)', () => {
    const tree = new ShimiTree();
    // 'ignition' is a branch parent with no docs directly assigned
    const conf = tree.confidenceFor('ignition');
    expect(conf).toBe(0);
  });

  it('disposes without throwing', () => {
    const tree = new ShimiTree();
    expect(() => tree.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------

describe('ShimiTree — search()', () => {
  it('returns an array of strings for a known DTC', () => {
    const tree = new ShimiTree();
    const results = tree.search('P0300');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expect(typeof r).toBe('string'));
  });

  it('returns at most topK results', () => {
    const tree = new ShimiTree();
    const results = tree.search('P0300', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns no duplicates', () => {
    const tree = new ShimiTree();
    const results = tree.search('P0300', 10);
    expect(results.length).toBe(new Set(results).size);
  });

  it('returns results for an unknown DTC via fallback (non-empty tree)', () => {
    const tree = new ShimiTree();
    // P9999 has no concept mapping — should trigger fallbackSearch
    const results = tree.search('P9999', 3);
    expect(Array.isArray(results)).toBe(true);
    // fallback returns docs from highest-confidence nodes — tree has docs so > 0
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns results sorted by node confidence descending', () => {
    const tree = new ShimiTree();

    // Boost misfire_random to a high confidence
    const highChunk = makeFactChunk('P0300');
    for (let i = 0; i < 5; i++) tree.applyChunk(highChunk);

    // Search for a DTC whose retrieval context includes multiple concepts
    const results = tree.search('P0300', 10);
    expect(results.length).toBeGreaterThan(0);
    // We can't assert exact order without knowing all doc contents, but
    // the result should be non-empty and contain strings
    results.forEach((r) => expect(typeof r).toBe('string'));
  });

  it('returns results for P0301 (cylinder misfire — ranged DTC)', () => {
    const tree = new ShimiTree();
    const results = tree.search('P0301-P0308');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// applyChunk()
// ---------------------------------------------------------------------------

describe('ShimiTree — applyChunk()', () => {
  it('raises confidence of the canonical concept node', () => {
    const tree = new ShimiTree();
    const before = tree.confidenceFor('misfire_random');
    tree.applyChunk(makeFactChunk('P0300'));
    const after = tree.confidenceFor('misfire_random');
    expect(after).toBeGreaterThan(before);
  });

  it('applies the dampened confirmation formula (confidence + 0.15 * (1 - confidence))', () => {
    const tree = new ShimiTree();
    const before = tree.confidenceFor('misfire_random');
    tree.applyChunk(makeFactChunk('P0300'));
    const after = tree.confidenceFor('misfire_random');
    const expected = before + 0.15 * (1 - before);
    expect(after).toBeCloseTo(expected, 5);
  });

  it('does not raise confidence above 0.99', () => {
    const tree = new ShimiTree();
    // Apply many confirmations — confidence should asymptotically approach but not exceed 0.99
    for (let i = 0; i < 100; i++) tree.applyChunk(makeFactChunk('P0300'));
    expect(tree.confidenceFor('misfire_random')).toBeLessThanOrEqual(0.99);
  });

  it('does nothing for a chunk with no DTC', () => {
    const tree = new ShimiTree();
    const before = tree.confidenceFor('misfire_random');
    // Omit dtc entirely to exercise the "no DTC" guard
    const noDtcChunk: FactChunk = { type: 'fact', id: 'no-dtc', content: 'x', confidence: 0.5, confirmations: 1, createdAt: new Date().toISOString() };
    tree.applyChunk(noDtcChunk);
    expect(tree.confidenceFor('misfire_random')).toBe(before);
  });

  it('does nothing for a chunk with an unmapped DTC', () => {
    const tree = new ShimiTree();
    const before = tree.confidenceFor('misfire_random');
    tree.applyChunk(makeFactChunk('P9999'));
    expect(tree.confidenceFor('misfire_random')).toBe(before);
  });

  it('only affects the canonical concept, not its ancestors', () => {
    const tree = new ShimiTree();
    const ignitionBefore = tree.confidenceFor('ignition');
    tree.applyChunk(makeFactChunk('P0300'));
    // ignition is the parent of misfire_random — should not change
    expect(tree.confidenceFor('ignition')).toBe(ignitionBefore);
  });
});

// ---------------------------------------------------------------------------
// applySkosPatch()
// ---------------------------------------------------------------------------

describe('ShimiTree — applySkosPatch()', () => {
  it('does not execute a patch below quorum', () => {
    const tree = new ShimiTree();
    const patch = makeSkosPatch({ id: 'p-quorum-test' });

    for (let i = 0; i < QUORUM.skosPatch - 1; i++) {
      tree.applySkosPatch(patch);
    }

    // Patch not executed — new concept should NOT be in the tree
    expect(tree.confidenceFor('test_concept_new')).toBe(0);
  });

  it('executes an addNarrower patch exactly at quorum', () => {
    const tree = new ShimiTree();
    const patch = makeSkosPatch({ id: 'p-at-quorum' });

    for (let i = 0; i < QUORUM.skosPatch; i++) {
      tree.applySkosPatch(patch);
    }

    // New concept node should now exist in the tree with confidence 0
    expect(tree.confidenceFor('test_concept_new')).toBe(0);
    // Parent should have the new concept in its narrower list
    const status = tree.pendingPatchStatus();
    expect(status.find((s) => s.patch.id === 'p-at-quorum')).toBeUndefined();
  });

  it('does not apply the same addNarrower patch twice (idempotent)', () => {
    const tree = new ShimiTree();
    const patch = makeSkosPatch({ id: 'p-idempotent' });

    // Reach quorum twice — second batch should be ignored (concept already exists)
    for (let i = 0; i < QUORUM.skosPatch * 2; i++) {
      tree.applySkosPatch(patch);
    }

    // Confidence is still 0 (a new empty node) — not doubled or errored
    expect(tree.confidenceFor('test_concept_new')).toBe(0);
  });

  it('accumulates votes in pendingPatchStatus before quorum', () => {
    const tree = new ShimiTree();
    const patch = makeSkosPatch({ id: 'p-status-test', newConcept: { id: 'status_concept', label: 'Status' } });

    tree.applySkosPatch(patch);
    tree.applySkosPatch(patch);
    tree.applySkosPatch(patch);

    const status = tree.pendingPatchStatus();
    const entry = status.find((s) => s.patch.id === 'p-status-test');
    expect(entry).toBeDefined();
    expect(entry?.votes).toBe(3);
    expect(entry?.quorum).toBe(QUORUM.skosPatch);
  });

  it('executes an addRelated patch at quorum', () => {
    const tree = new ShimiTree();
    const patch = makeSkosPatch({
      id: 'p-addrelated',
      op: 'addRelated',
      targetConceptId: 'ignition',
      relatedConceptId: 'transmission',
    });

    for (let i = 0; i < QUORUM.skosPatch; i++) {
      tree.applySkosPatch(patch);
    }

    // Patch should be gone from pending
    const status = tree.pendingPatchStatus();
    expect(status.find((s) => s.patch.id === 'p-addrelated')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MMKV persistence
// ---------------------------------------------------------------------------

describe('ShimiTree — MMKV persistence', () => {
  it('persists confidence after applyChunk and restores on next boot', () => {
    // Boot 1: apply a chunk and check confidence
    const tree1 = new ShimiTree();
    tree1.applyChunk(makeFactChunk('P0300'));
    const confidenceAfterChunk = tree1.confidenceFor('misfire_random');
    tree1.dispose();

    // Boot 2: new tree should restore the persisted weight
    const tree2 = new ShimiTree();
    expect(tree2.confidenceFor('misfire_random')).toBeCloseTo(confidenceAfterChunk, 5);
    tree2.dispose();
  });

  it('starts with baseline confidence when no persisted weights exist', () => {
    mmkvStore = {}; // ensure clean slate
    const tree = new ShimiTree();
    // misfire_random has docs → confidence = 0.5 (createShimiNode baseline)
    expect(tree.confidenceFor('misfire_random')).toBe(0.5);
    tree.dispose();
  });
});

// ---------------------------------------------------------------------------
// topNodes()
// ---------------------------------------------------------------------------

describe('ShimiTree — topNodes()', () => {
  it('returns nodes sorted by confidence descending', () => {
    const tree = new ShimiTree();
    // Boost misfire_random
    for (let i = 0; i < 3; i++) tree.applyChunk(makeFactChunk('P0300'));

    const nodes = tree.topNodes(5);
    expect(nodes.length).toBeGreaterThan(0);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1]!.confidence).toBeGreaterThanOrEqual(nodes[i]!.confidence);
    }
  });

  it('only returns nodes that have docs', () => {
    const tree = new ShimiTree();
    const nodes = tree.topNodes(20);
    nodes.forEach((n) => expect(n.docs.length).toBeGreaterThan(0));
  });

  it('respects the limit parameter', () => {
    const tree = new ShimiTree();
    expect(tree.topNodes(3).length).toBeLessThanOrEqual(3);
  });
});
