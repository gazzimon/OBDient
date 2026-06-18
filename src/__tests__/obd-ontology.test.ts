// Tests for obd-ontology.ts — SKOS concept navigation helpers.
// All functions are pure (no I/O, no side effects), so no mocks needed.

import {
  conceptForDtc,
  ancestors,
  retrievalContext,
  CONCEPT_MAP,
  DTC_TO_CONCEPT,
} from '@/data/knowledge/obd-ontology';

// ---------------------------------------------------------------------------
// conceptForDtc
// ---------------------------------------------------------------------------

describe('conceptForDtc', () => {
  it('returns the canonical concept for a known DTC', () => {
    const node = conceptForDtc('P0300');
    expect(node).not.toBeNull();
    expect(node?.id).toBe('misfire_random');
  });

  it('returns the canonical concept for a ranged DTC id', () => {
    const node = conceptForDtc('P0301-P0308');
    expect(node?.id).toBe('misfire_cylinder');
  });

  it('returns null for an unknown DTC', () => {
    expect(conceptForDtc('P9999')).toBeNull();
  });

  it('maps every DTC id in OBD_KNOWLEDGE to a concept', () => {
    // All DTC_TO_CONCEPT entries must resolve to a real node in CONCEPT_MAP
    for (const [dtcId, concept] of Object.entries(DTC_TO_CONCEPT)) {
      expect(CONCEPT_MAP[concept.id]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ancestors
// ---------------------------------------------------------------------------

describe('ancestors', () => {
  it('returns the full ancestor chain from leaf to root', () => {
    const chain = ancestors('misfire_random');
    const ids = chain.map((c) => c.id);
    expect(ids).toContain('ignition');
    expect(ids).toContain('powertrain');
  });

  it('returns ancestors in order — closest parent first', () => {
    const chain = ancestors('misfire_random');
    expect(chain[0]?.id).toBe('ignition');
    expect(chain[1]?.id).toBe('powertrain');
  });

  it('returns an empty array for a root concept', () => {
    expect(ancestors('powertrain')).toHaveLength(0);
  });

  it('returns an empty array for an unknown concept id', () => {
    expect(ancestors('does_not_exist')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// retrievalContext
// ---------------------------------------------------------------------------

describe('retrievalContext', () => {
  it('returns canonical node + ancestors + related nodes', () => {
    const ctx = retrievalContext('P0300');
    const ids = ctx.map((c) => c.id);

    // Canonical node
    expect(ids).toContain('misfire_random');
    // Ancestors
    expect(ids).toContain('ignition');
    expect(ids).toContain('powertrain');
    // SKOS related — misfire_random.related = ['misfire_cylinder', 'fuel_delivery', 'catalyst']
    expect(ids).toContain('misfire_cylinder');
    expect(ids).toContain('fuel_delivery');
    expect(ids).toContain('catalyst');
  });

  it('does not include duplicates', () => {
    const ctx = retrievalContext('P0300');
    const ids = ctx.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('returns empty array for an unknown DTC', () => {
    expect(retrievalContext('P9999')).toHaveLength(0);
  });

  it('returns a narrower context for a deep leaf concept (EVAP)', () => {
    // P0442-P0455 → evap → emissions → powertrain
    const ctx = retrievalContext('P0442-P0455');
    const ids = ctx.map((c) => c.id);
    expect(ids).toContain('evap');
    expect(ids).toContain('emissions');
    expect(ids).toContain('powertrain');
    // Should NOT include ignition or fuel branches (no related link)
    expect(ids).not.toContain('ignition');
  });

  it('cross-branch relations work — catalyst is related to misfires', () => {
    // P0420-P0430 → catalyst, which is related to misfire_random and misfire_cylinder
    const ctx = retrievalContext('P0420-P0430');
    const ids = ctx.map((c) => c.id);
    expect(ids).toContain('catalyst');
    expect(ids).toContain('misfire_random');
    expect(ids).toContain('misfire_cylinder');
  });
});

// ---------------------------------------------------------------------------
// CONCEPT_MAP integrity
// ---------------------------------------------------------------------------

describe('CONCEPT_MAP integrity', () => {
  it('every narrower reference points to an existing concept', () => {
    for (const concept of Object.values(CONCEPT_MAP)) {
      for (const childId of concept.narrower) {
        expect(CONCEPT_MAP[childId]).toBeDefined();
      }
    }
  });

  it('every related reference points to an existing concept', () => {
    for (const concept of Object.values(CONCEPT_MAP)) {
      for (const relId of concept.related) {
        expect(CONCEPT_MAP[relId]).toBeDefined();
      }
    }
  });

  it('every broader reference points to an existing concept', () => {
    for (const concept of Object.values(CONCEPT_MAP)) {
      if (concept.broader !== null) {
        expect(CONCEPT_MAP[concept.broader]).toBeDefined();
      }
    }
  });
});
