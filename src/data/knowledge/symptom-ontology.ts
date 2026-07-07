// User-reported symptom ontology (ADR-0006-A Phase 0, seed from Appendix A).
//
// Symptom nodes reuse SkosConceptNode (broader = category, root 'symptom');
// the weighted hypothesis→symptom edge lives APART so the cause tree and the
// symptom tree stay separate. Weights map to curated log-likelihood ratios:
//   strong → pHit≈.80 / pFp≈.15 → llr ≈ +1.67
//   medium → pHit≈.50 / pFp≈.25 → llr ≈ +0.69
//   weak   → pHit≈.30 / pFp≈.25 → llr ≈ +0.18
// Weights become learnable in ADR-0006-A Phase 4 (Beta-Binomial, ADR-0004).
//
// Body/Chassis branches (brakes, steering, suspension) are deliberately absent
// until obd-ontology.ts covers those causes — a symptom with no hypothesis to
// attach to would be dead weight.

import type { SkosConceptNode } from './obd-ontology';

export type SymptomWeight = 'strong' | 'medium' | 'weak';

// hypothesis is an OBD_ONTOLOGY concept id; symptom is a node id from below.
export interface ManifestsEdge {
  readonly hypothesis: string;
  readonly symptom: string;
  readonly weight: SymptomWeight;
}

// ---------------------------------------------------------------------------
// Category tree (root → categories → symptoms)
// ---------------------------------------------------------------------------

const CATEGORY_IDS = [
  'driveability', 'starting', 'idle', 'noise', 'smell',
  'smoke', 'fluid', 'temperature', 'electrical', 'dash',
] as const;

function categoryNode(id: string, label: string, narrower: readonly string[]): SkosConceptNode {
  return { id, label, broader: 'symptom', narrower, related: [], dtcs: [], conditionIds: [] };
}

function symptomNode(id: string, label: string, broader: string): SkosConceptNode {
  return { id, label, broader, narrower: [], related: [], dtcs: [], conditionIds: [] };
}

const ROOT_SYMPTOM: SkosConceptNode = {
  id: 'symptom',
  label: 'Reported symptom',
  broader: null,
  narrower: [...CATEGORY_IDS],
  related: [],
  dtcs: [],
  conditionIds: [],
};

export const SYMPTOM_ONTOLOGY: readonly SkosConceptNode[] = [
  ROOT_SYMPTOM,
  categoryNode('driveability', 'Driveability', [
    'sym_hesitation', 'sym_power_loss', 'sym_surging', 'sym_knock_ping',
    'sym_stall', 'sym_harsh_shift', 'sym_high_consumption',
  ]),
  categoryNode('starting', 'Starting', [
    'sym_no_start', 'sym_hard_start_cold', 'sym_hard_start_hot', 'sym_long_crank',
  ]),
  categoryNode('idle', 'Idle', ['sym_rough_idle', 'sym_high_idle', 'sym_low_idle']),
  categoryNode('noise', 'Noises', [
    'sym_engine_knock_noise', 'sym_hiss_vacuum', 'sym_exhaust_rattle',
  ]),
  categoryNode('smell', 'Smells', [
    'sym_smell_fuel', 'sym_smell_burning', 'sym_smell_sulfur', 'sym_smell_coolant',
  ]),
  categoryNode('smoke', 'Smoke', ['sym_smoke_white', 'sym_smoke_blue', 'sym_smoke_black']),
  categoryNode('fluid', 'Fluid leaks', ['sym_coolant_leak', 'sym_oil_leak', 'sym_fuel_leak']),
  categoryNode('temperature', 'Temperature', ['sym_overheating', 'sym_no_warmup']),
  categoryNode('electrical', 'Electrical', [
    'sym_dim_flicker_lights', 'sym_battery_drain', 'sym_accessory_fault',
  ]),
  categoryNode('dash', 'Dash / warning lights', [
    'sym_cel_flashing', 'sym_temp_light', 'sym_oil_light', 'sym_battery_light',
  ]),
  // Driveability
  symptomNode('sym_hesitation', 'Hesitation / stumble on acceleration', 'driveability'),
  symptomNode('sym_power_loss', 'Loss of power', 'driveability'),
  symptomNode('sym_surging', 'RPM surging', 'driveability'),
  symptomNode('sym_knock_ping', 'Knocking / pinging under load', 'driveability'),
  symptomNode('sym_stall', 'Stalls while driving', 'driveability'),
  symptomNode('sym_harsh_shift', 'Harsh gear shifts', 'driveability'),
  symptomNode('sym_high_consumption', 'High fuel consumption', 'driveability'),
  // Starting
  symptomNode('sym_no_start', 'Engine does not start', 'starting'),
  symptomNode('sym_hard_start_cold', 'Hard start when cold', 'starting'),
  symptomNode('sym_hard_start_hot', 'Hard start when hot', 'starting'),
  symptomNode('sym_long_crank', 'Long cranking before start', 'starting'),
  // Idle
  symptomNode('sym_rough_idle', 'Rough / shaky idle', 'idle'),
  symptomNode('sym_high_idle', 'High idle', 'idle'),
  symptomNode('sym_low_idle', 'Low idle / almost stalls', 'idle'),
  // Noise
  symptomNode('sym_engine_knock_noise', 'Metallic knocking noise from engine', 'noise'),
  symptomNode('sym_hiss_vacuum', 'Hissing / vacuum sound', 'noise'),
  symptomNode('sym_exhaust_rattle', 'Rattle from the exhaust', 'noise'),
  // Smell
  symptomNode('sym_smell_fuel', 'Fuel smell', 'smell'),
  symptomNode('sym_smell_burning', 'Burning smell', 'smell'),
  symptomNode('sym_smell_sulfur', 'Sulfur / rotten egg smell', 'smell'),
  symptomNode('sym_smell_coolant', 'Sweet / coolant smell', 'smell'),
  // Smoke
  symptomNode('sym_smoke_white', 'White smoke from exhaust', 'smoke'),
  symptomNode('sym_smoke_blue', 'Blue smoke from exhaust', 'smoke'),
  symptomNode('sym_smoke_black', 'Black smoke from exhaust', 'smoke'),
  // Fluid
  symptomNode('sym_coolant_leak', 'Coolant loss / leak', 'fluid'),
  symptomNode('sym_oil_leak', 'Oil leak', 'fluid'),
  symptomNode('sym_fuel_leak', 'Fuel leak', 'fluid'),
  // Temperature
  symptomNode('sym_overheating', 'Overheating (gauge runs high)', 'temperature'),
  symptomNode('sym_no_warmup', 'Never warms up / slow warm-up', 'temperature'),
  // Electrical
  symptomNode('sym_dim_flicker_lights', 'Dim or flickering lights', 'electrical'),
  symptomNode('sym_battery_drain', 'Battery drains', 'electrical'),
  symptomNode('sym_accessory_fault', 'Accessories / electronics misbehave', 'electrical'),
  // Dash
  symptomNode('sym_cel_flashing', 'Check engine light FLASHING', 'dash'),
  symptomNode('sym_temp_light', 'Temperature warning light', 'dash'),
  symptomNode('sym_oil_light', 'Oil pressure warning light', 'dash'),
  symptomNode('sym_battery_light', 'Battery / charging warning light', 'dash'),
];

export const SYMPTOM_MAP: Readonly<Record<string, SkosConceptNode>> =
  Object.fromEntries(SYMPTOM_ONTOLOGY.map((n) => [n.id, n]));

// ---------------------------------------------------------------------------
// Curated manifestsAs edges (ADR-0006-A Appendix A, verbatim seed)
// ---------------------------------------------------------------------------

function edges(
  symptom: string,
  pairs: ReadonlyArray<[hypothesis: string, weight: SymptomWeight]>,
): ManifestsEdge[] {
  return pairs.map(([hypothesis, weight]) => ({ hypothesis, symptom, weight }));
}

export const MANIFESTS_AS: readonly ManifestsEdge[] = [
  ...edges('sym_hesitation', [
    ['fuel_delivery', 'strong'], ['sensor_maf', 'medium'], ['throttle', 'medium'],
    ['misfire_random', 'medium'], ['fuel_injectors', 'medium'],
  ]),
  ...edges('sym_power_loss', [
    ['turbo', 'strong'], ['fuel_delivery', 'medium'], ['catalyst', 'medium'],
    ['fuel_lean', 'medium'], ['sensor_maf', 'medium'],
  ]),
  ...edges('sym_surging', [
    ['live_rpm', 'strong'], ['fuel_mixture', 'medium'], ['throttle', 'medium'], ['vvt', 'weak'],
  ]),
  ...edges('sym_knock_ping', [
    ['sensor_knock', 'strong'], ['timing_correlation', 'medium'],
    ['fuel_lean', 'medium'], ['egr', 'weak'],
  ]),
  ...edges('sym_stall', [
    ['fuel_delivery', 'strong'], ['sensor_crank', 'medium'],
    ['fuel_lean', 'medium'], ['throttle', 'medium'],
  ]),
  ...edges('sym_harsh_shift', [['transmission', 'strong']]),
  ...edges('sym_high_consumption', [
    ['fuel_rich', 'strong'], ['sensor_o2', 'medium'], ['sensor_maf', 'medium'],
    ['catalyst', 'weak'],
  ]),
  ...edges('sym_no_start', [
    ['sensor_crank', 'strong'], ['fuel_delivery', 'strong'], ['live_voltage', 'medium'],
  ]),
  ...edges('sym_hard_start_cold', [
    ['sensor_temperature', 'strong'], ['fuel_mixture', 'medium'], ['fuel_delivery', 'medium'],
  ]),
  ...edges('sym_hard_start_hot', [
    ['fuel_rich', 'medium'], ['fuel_delivery', 'medium'], ['sensor_o2', 'weak'],
  ]),
  ...edges('sym_long_crank', [
    ['fuel_delivery', 'strong'], ['sensor_crank', 'medium'], ['sensor_cam', 'medium'],
  ]),
  ...edges('sym_rough_idle', [
    ['misfire_random', 'strong'], ['misfire_cylinder', 'medium'], ['fuel_mixture', 'medium'],
    ['egr', 'medium'], ['live_rpm', 'medium'], ['vvt', 'weak'],
  ]),
  ...edges('sym_high_idle', [
    ['throttle', 'strong'], ['live_rpm', 'medium'], ['vvt', 'weak'],
  ]),
  ...edges('sym_low_idle', [['fuel_mixture', 'medium'], ['throttle', 'medium']]),
  ...edges('sym_engine_knock_noise', [
    ['live_oil', 'strong'], ['timing_correlation', 'medium'],
  ]),
  ...edges('sym_hiss_vacuum', [
    ['fuel_lean', 'strong'], ['turbo', 'medium'], ['evap', 'weak'],
  ]),
  ...edges('sym_exhaust_rattle', [['catalyst', 'strong']]),
  ...edges('sym_smell_fuel', [
    ['fuel_rich', 'strong'], ['fuel_injectors', 'medium'], ['evap', 'medium'],
  ]),
  ...edges('sym_smell_burning', [['live_oil', 'medium'], ['catalyst', 'medium']]),
  ...edges('sym_smell_sulfur', [['catalyst', 'strong'], ['fuel_rich', 'medium']]),
  ...edges('sym_smell_coolant', [['live_overheat', 'strong']]),
  ...edges('sym_smoke_white', [
    ['live_overheat', 'strong'], ['sensor_temperature', 'weak'],
  ]),
  ...edges('sym_smoke_blue', [['live_oil', 'strong'], ['vvt', 'weak']]),
  ...edges('sym_smoke_black', [
    ['fuel_rich', 'strong'], ['sensor_maf', 'medium'], ['fuel_injectors', 'medium'],
  ]),
  ...edges('sym_coolant_leak', [['live_overheat', 'strong']]),
  ...edges('sym_oil_leak', [['live_oil', 'strong']]),
  ...edges('sym_fuel_leak', [['fuel_injectors', 'strong'], ['fuel_delivery', 'medium']]),
  ...edges('sym_overheating', [
    ['live_overheat', 'strong'], ['sensor_temperature', 'medium'],
  ]),
  ...edges('sym_no_warmup', [['sensor_temperature', 'strong']]),
  ...edges('sym_dim_flicker_lights', [['live_voltage', 'strong']]),
  ...edges('sym_battery_drain', [['live_voltage', 'strong']]),
  ...edges('sym_accessory_fault', [['live_voltage', 'medium'], ['network', 'medium']]),
  ...edges('sym_cel_flashing', [
    ['misfire_random', 'strong'], ['misfire_cylinder', 'strong'],
  ]),
  ...edges('sym_temp_light', [['live_overheat', 'strong']]),
  ...edges('sym_oil_light', [['live_oil', 'strong']]),
  ...edges('sym_battery_light', [['live_voltage', 'strong']]),
];

// ---------------------------------------------------------------------------
// Navigation helpers (pure)
// ---------------------------------------------------------------------------

/** manifestsAs(h, ·) — the likelihood term inputs for one hypothesis. */
export function expectedSymptoms(hypothesisId: string): ManifestsEdge[] {
  return MANIFESTS_AS.filter((e) => e.hypothesis === hypothesisId);
}

/** Picker pre-filter: symptoms manifested by any of the given fault-class
 *  concepts (typically the union of faultClassClosure() over active DTCs).
 *  Deduplicated, edge declaration order preserved. */
export function symptomsForConcepts(conceptIds: readonly string[]): string[] {
  const wanted = new Set(conceptIds);
  const seen = new Set<string>();
  for (const edge of MANIFESTS_AS) {
    if (wanted.has(edge.hypothesis)) seen.add(edge.symptom);
  }
  return [...seen];
}
