// Tests for symptom-ontology.ts — ADR-0006-A Phase 0 seed integrity.
// The critical property: every manifestsAs edge must resolve on BOTH ends
// (hypothesis in the cause ontology, symptom in this taxonomy), or the picker
// pre-filter and the future likelihood term would silently drop evidence.

import {
  SYMPTOM_ONTOLOGY,
  SYMPTOM_MAP,
  MANIFESTS_AS,
  expectedSymptoms,
  symptomsForConcepts,
} from '@/data/knowledge/symptom-ontology';
import { CONCEPT_MAP } from '@/data/knowledge/obd-ontology';

describe('symptom taxonomy integrity', () => {
  it('every node id is unique', () => {
    const ids = SYMPTOM_ONTOLOGY.map((n) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('every category narrower reference resolves to a symptom node', () => {
    const root = SYMPTOM_MAP['symptom'];
    expect(root).toBeDefined();
    for (const categoryId of root?.narrower ?? []) {
      const category = SYMPTOM_MAP[categoryId];
      expect(category).toBeDefined();
      for (const symptomId of category?.narrower ?? []) {
        expect(SYMPTOM_MAP[symptomId]).toBeDefined();
      }
    }
  });

  it('every symptom node hangs from a category, and categories from the root', () => {
    for (const node of SYMPTOM_ONTOLOGY) {
      if (node.id === 'symptom') continue;
      expect(node.broader).not.toBeNull();
      expect(SYMPTOM_MAP[node.broader ?? '']).toBeDefined();
    }
  });

  it('every symptom listed in a category declares that category as broader', () => {
    for (const node of SYMPTOM_ONTOLOGY) {
      for (const childId of node.narrower) {
        expect(SYMPTOM_MAP[childId]?.broader).toBe(node.id);
      }
    }
  });
});

describe('manifestsAs edge integrity', () => {
  it('every edge hypothesis resolves in the cause ontology (obd-ontology)', () => {
    for (const edge of MANIFESTS_AS) {
      expect(CONCEPT_MAP[edge.hypothesis]).toBeDefined();
    }
  });

  it('every edge symptom resolves in the symptom taxonomy', () => {
    for (const edge of MANIFESTS_AS) {
      expect(SYMPTOM_MAP[edge.symptom]).toBeDefined();
    }
  });

  it('every leaf symptom has at least one edge (no dead chips in the picker)', () => {
    const leaves = SYMPTOM_ONTOLOGY.filter((n) => n.id.startsWith('sym_'));
    const withEdges = new Set(MANIFESTS_AS.map((e) => e.symptom));
    for (const leaf of leaves) {
      expect(withEdges.has(leaf.id)).toBe(true);
    }
  });

  it('no duplicate (hypothesis, symptom) pairs', () => {
    const keys = MANIFESTS_AS.map((e) => `${e.hypothesis}→${e.symptom}`);
    expect(keys.length).toBe(new Set(keys).size);
  });
});

describe('expectedSymptoms', () => {
  it('returns the manifestsAs edges of one hypothesis', () => {
    const edges = expectedSymptoms('live_voltage');
    const symptoms = edges.map((e) => e.symptom).sort();
    expect(symptoms).toEqual([
      'sym_accessory_fault',
      'sym_battery_drain',
      'sym_battery_light',
      'sym_dim_flicker_lights',
      'sym_no_start',
    ]);
  });

  it('returns empty for a hypothesis with no symptom edges', () => {
    expect(expectedSymptoms('powertrain')).toHaveLength(0);
  });
});

describe('symptomsForConcepts — picker pre-filter', () => {
  it('returns the symptoms manifested by the given fault classes', () => {
    const symptoms = symptomsForConcepts(['catalyst']);
    expect(symptoms).toEqual(expect.arrayContaining([
      'sym_power_loss',
      'sym_exhaust_rattle',
      'sym_smell_sulfur',
      'sym_smell_burning',
      'sym_high_consumption',
    ]));
  });

  it('deduplicates across concepts sharing symptoms', () => {
    const symptoms = symptomsForConcepts(['misfire_random', 'misfire_cylinder']);
    // sym_rough_idle and sym_cel_flashing are manifested by both
    expect(symptoms.filter((s) => s === 'sym_rough_idle')).toHaveLength(1);
    expect(symptoms.filter((s) => s === 'sym_cel_flashing')).toHaveLength(1);
  });

  it('returns empty for concepts with no edges', () => {
    expect(symptomsForConcepts(['body', 'chassis'])).toHaveLength(0);
  });
});
