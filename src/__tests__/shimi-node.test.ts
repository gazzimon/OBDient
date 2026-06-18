// Tests for shimi-node.ts — confidence update and decay formulas.

import { createShimiNode, applyConfirmation, applyDecay } from '@/data/knowledge/shimi-node';
import type { SkosConceptNode } from '@/data/knowledge/obd-ontology';
import type { KnowledgeDoc } from '@/data/knowledge/obd-knowledge';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fakeConcept: SkosConceptNode = {
  id: 'test_concept',
  label: 'Test concept',
  broader: null,
  narrower: [],
  related: [],
  dtcs: ['P0300'],
  conditionIds: [],
};

const fakeDoc: KnowledgeDoc = {
  id: 'P0300',
  conceptId: 'test_concept',
  content: 'P0300 random misfire.',
};

// ---------------------------------------------------------------------------
// createShimiNode
// ---------------------------------------------------------------------------

describe('createShimiNode', () => {
  it('starts at 0.5 confidence when docs are provided', () => {
    const node = createShimiNode(fakeConcept, [fakeDoc]);
    expect(node.confidence).toBe(0.5);
    expect(node.confirmations).toBe(0);
  });

  it('starts at 0 confidence when no docs are provided', () => {
    const node = createShimiNode(fakeConcept, []);
    expect(node.confidence).toBe(0);
  });

  it('carries the correct concept and docs', () => {
    const node = createShimiNode(fakeConcept, [fakeDoc]);
    expect(node.concept.id).toBe('test_concept');
    expect(node.docs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyConfirmation
// ---------------------------------------------------------------------------

describe('applyConfirmation', () => {
  it('raises confidence toward 1 on each confirmation', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]);
    const before = node.confidence; // 0.5

    node = applyConfirmation(node);
    expect(node.confidence).toBeGreaterThan(before);
    expect(node.confirmations).toBe(1);
  });

  it('uses dampened update — each step moves 15% of remaining gap', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]); // confidence = 0.5
    node = applyConfirmation(node);
    // expected: 0.5 + (1 - 0.5) * 0.15 = 0.575
    expect(node.confidence).toBeCloseTo(0.575, 5);
  });

  it('never exceeds 0.99', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]);
    for (let i = 0; i < 200; i++) {
      node = applyConfirmation(node);
    }
    expect(node.confidence).toBeLessThanOrEqual(0.99);
  });

  it('increments confirmations counter', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]);
    node = applyConfirmation(node);
    node = applyConfirmation(node);
    node = applyConfirmation(node);
    expect(node.confirmations).toBe(3);
  });

  it('does not mutate the original node', () => {
    const node = createShimiNode(fakeConcept, [fakeDoc]);
    const original = node.confidence;
    applyConfirmation(node);
    expect(node.confidence).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// applyDecay
// ---------------------------------------------------------------------------

describe('applyDecay', () => {
  it('reduces confidence above 0.5 by 2%', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]);
    // Raise confidence above baseline first
    node = applyConfirmation(node); // ~0.575
    const before = node.confidence;

    node = applyDecay(node);
    expect(node.confidence).toBeCloseTo(before * 0.98, 5);
  });

  it('never decays below 0.5 (static baseline floor)', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]); // 0.5
    for (let i = 0; i < 100; i++) {
      node = applyDecay(node);
    }
    expect(node.confidence).toBe(0.5);
  });

  it('does not decay nodes at exactly 0.5', () => {
    const node = createShimiNode(fakeConcept, [fakeDoc]); // 0.5
    const after = applyDecay(node);
    expect(after.confidence).toBe(0.5);
  });

  it('does not mutate the original node', () => {
    let node = createShimiNode(fakeConcept, [fakeDoc]);
    node = applyConfirmation(node);
    const before = node.confidence;
    applyDecay(node);
    expect(node.confidence).toBe(before);
  });
});
