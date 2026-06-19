// OBD-II domain ontology — SKOS-inspired vocabulary.
//
// Implements a lightweight SKOS (Simple Knowledge Organization System) structure:
//   broader  → parent concept (narrower inverse)
//   narrower → child concepts
//   related  → cross-branch relationships (solves the tree/graph tension)
//
// Design decisions:
//   - Every concept has a stable URI-style id (snake_case, no spaces).
//   - DTCs are mapped to their CANONICAL concept (most specific branch).
//   - Cross-cutting membership (e.g. P0300 touches Ignition AND Emissions)
//     is expressed via `related`, not by duplicating nodes.
//   - The tree root is split by OBD-II prefix: Powertrain (P), Body (B),
//     Chassis (C), Network (U).

export interface SkosConceptNode {
  readonly id: string;
  readonly label: string;
  readonly broader: string | null;        // parent concept id, null = root
  readonly narrower: readonly string[];   // child concept ids
  readonly related: readonly string[];    // cross-branch concept ids (SKOS related)
  readonly dtcs: readonly string[];       // DTC ids or ranges that belong here
  readonly conditionIds: readonly string[]; // non-DTC condition ids (live params)
}

// ---------------------------------------------------------------------------
// Root concepts
// ---------------------------------------------------------------------------

const ROOT_POWERTRAIN: SkosConceptNode = {
  id: 'powertrain',
  label: 'Powertrain (P)',
  broader: null,
  narrower: ['ignition', 'fuel_system', 'emissions', 'sensors_engine', 'transmission', 'turbo'],
  related: [],
  dtcs: ['dtc-prefixes'],
  conditionIds: [],
};

const ROOT_BODY: SkosConceptNode = {
  id: 'body',
  label: 'Body (B)',
  broader: null,
  narrower: [],
  related: [],
  dtcs: [],
  conditionIds: [],
};

const ROOT_CHASSIS: SkosConceptNode = {
  id: 'chassis',
  label: 'Chassis (C)',
  broader: null,
  narrower: [],
  related: [],
  dtcs: [],
  conditionIds: [],
};

const ROOT_NETWORK: SkosConceptNode = {
  id: 'network',
  label: 'Network / Communication (U)',
  broader: null,
  narrower: [],
  related: [],
  dtcs: [],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Powertrain — Ignition branch
// ---------------------------------------------------------------------------

const IGNITION: SkosConceptNode = {
  id: 'ignition',
  label: 'Ignition system',
  broader: 'powertrain',
  narrower: ['misfire_random', 'misfire_cylinder', 'vvt', 'timing_correlation'],
  // P0300/P030x misfires also affect emissions — cross-branch relation
  related: ['emissions', 'fuel_system'],
  dtcs: [],
  conditionIds: [],
};

const MISFIRE_RANDOM: SkosConceptNode = {
  id: 'misfire_random',
  label: 'Random / multiple cylinder misfire',
  broader: 'ignition',
  narrower: [],
  related: ['misfire_cylinder', 'fuel_delivery', 'catalyst'],
  dtcs: ['P0300'],
  conditionIds: [],
};

const MISFIRE_CYLINDER: SkosConceptNode = {
  id: 'misfire_cylinder',
  label: 'Single cylinder misfire (P0301–P0308)',
  broader: 'ignition',
  narrower: [],
  related: ['misfire_random', 'fuel_injectors'],
  dtcs: ['P0301-P0308'],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Powertrain — Fuel system branch
// ---------------------------------------------------------------------------

const FUEL_SYSTEM: SkosConceptNode = {
  id: 'fuel_system',
  label: 'Fuel system',
  broader: 'powertrain',
  narrower: ['fuel_mixture', 'fuel_delivery', 'fuel_injectors'],
  related: ['ignition', 'sensors_engine'],
  dtcs: [],
  conditionIds: [],
};

const FUEL_MIXTURE: SkosConceptNode = {
  id: 'fuel_mixture',
  label: 'Air/fuel mixture',
  broader: 'fuel_system',
  narrower: ['fuel_lean', 'fuel_rich'],
  related: ['sensors_engine', 'emissions'],
  dtcs: [],
  conditionIds: [],
};

const FUEL_LEAN: SkosConceptNode = {
  id: 'fuel_lean',
  label: 'System too lean (P0171/P0174)',
  broader: 'fuel_mixture',
  narrower: [],
  related: ['fuel_rich', 'sensors_engine'],
  dtcs: ['P0171-P0174'],
  conditionIds: [],
};

const FUEL_RICH: SkosConceptNode = {
  id: 'fuel_rich',
  label: 'System too rich (P0172/P0175)',
  broader: 'fuel_mixture',
  narrower: [],
  related: ['fuel_lean', 'sensors_engine'],
  dtcs: ['P0172-P0175'],
  conditionIds: [],
};

const FUEL_DELIVERY: SkosConceptNode = {
  id: 'fuel_delivery',
  label: 'Fuel delivery (pump, pressure, rail)',
  broader: 'fuel_system',
  narrower: [],
  related: ['fuel_injectors', 'misfire_random'],
  dtcs: ['P0087', 'P0088'],
  conditionIds: ['cond-fuel-pressure'],
};

const FUEL_INJECTORS: SkosConceptNode = {
  id: 'fuel_injectors',
  label: 'Fuel injectors',
  broader: 'fuel_system',
  narrower: [],
  related: ['misfire_cylinder', 'fuel_delivery'],
  dtcs: [],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Powertrain — Emissions branch
// ---------------------------------------------------------------------------

const EMISSIONS: SkosConceptNode = {
  id: 'emissions',
  label: 'Emissions control',
  broader: 'powertrain',
  narrower: ['catalyst', 'evap', 'egr'],
  related: ['ignition', 'fuel_mixture'],
  dtcs: [],
  conditionIds: [],
};

const CATALYST: SkosConceptNode = {
  id: 'catalyst',
  label: 'Catalytic converter (P0420/P0430)',
  broader: 'emissions',
  narrower: [],
  // Catalyst failure often follows unresolved misfires
  related: ['misfire_random', 'misfire_cylinder'],
  dtcs: ['P0420-P0430'],
  conditionIds: [],
};

const EVAP: SkosConceptNode = {
  id: 'evap',
  label: 'Evaporative emissions (EVAP) — P0442/P0455',
  broader: 'emissions',
  narrower: [],
  related: [],
  dtcs: ['P0442-P0455'],
  conditionIds: [],
};

const EGR: SkosConceptNode = {
  id: 'egr',
  label: 'Exhaust Gas Recirculation (EGR) — P0401',
  broader: 'emissions',
  narrower: [],
  related: ['fuel_mixture'],
  dtcs: ['P0401'],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Powertrain — Timing / VVT branch
// ---------------------------------------------------------------------------

const TIMING_CORRELATION: SkosConceptNode = {
  id: 'timing_correlation',
  label: 'Crankshaft/camshaft timing correlation (P0016/P0017)',
  broader: 'ignition',
  narrower: [],
  related: ['vvt', 'sensor_crank', 'sensor_cam'],
  dtcs: ['P0016', 'P0017'],
  conditionIds: [],
};

const VVT: SkosConceptNode = {
  id: 'vvt',
  label: 'Variable Valve Timing (VVT) — P0011/P0012',
  broader: 'ignition',
  narrower: [],
  related: ['timing_correlation', 'sensor_cam'],
  dtcs: ['P0011', 'P0012'],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Powertrain — Engine sensors branch
// ---------------------------------------------------------------------------

const SENSORS_ENGINE: SkosConceptNode = {
  id: 'sensors_engine',
  label: 'Engine sensors',
  broader: 'powertrain',
  narrower: ['sensor_temperature', 'sensor_speed', 'sensor_o2', 'sensor_maf', 'sensor_crank', 'sensor_cam', 'sensor_knock'],
  related: ['fuel_system'],
  dtcs: [],
  conditionIds: [],
};

const SENSOR_TEMPERATURE: SkosConceptNode = {
  id: 'sensor_temperature',
  label: 'Temperature sensors (IAT / ECT) — P0113/P0118',
  broader: 'sensors_engine',
  narrower: [],
  related: ['fuel_mixture', 'live_overheat'],
  dtcs: ['P0113-P0118', 'P0128'],
  conditionIds: ['cond-overheat'],
};

const SENSOR_SPEED: SkosConceptNode = {
  id: 'sensor_speed',
  label: 'Vehicle Speed Sensor (VSS) — P0500',
  broader: 'sensors_engine',
  narrower: [],
  related: [],
  dtcs: ['P0500'],
  conditionIds: [],
};

const SENSOR_O2: SkosConceptNode = {
  id: 'sensor_o2',
  label: 'Oxygen / lambda sensors (P0130–P0167)',
  broader: 'sensors_engine',
  narrower: [],
  related: ['catalyst', 'fuel_mixture'],
  dtcs: ['P0130-P0167'],
  conditionIds: [],
};

const SENSOR_MAF: SkosConceptNode = {
  id: 'sensor_maf',
  label: 'Mass Air Flow sensor (P0100–P0104)',
  broader: 'sensors_engine',
  narrower: [],
  related: ['fuel_lean', 'fuel_rich', 'throttle'],
  dtcs: ['P0100-P0104'],
  conditionIds: [],
};

const SENSOR_CRANK: SkosConceptNode = {
  id: 'sensor_crank',
  label: 'Crankshaft Position Sensor (P0335–P0338)',
  broader: 'sensors_engine',
  narrower: [],
  related: ['timing_correlation', 'misfire_random'],
  dtcs: ['P0335-P0338'],
  conditionIds: [],
};

const SENSOR_CAM: SkosConceptNode = {
  id: 'sensor_cam',
  label: 'Camshaft Position Sensor (P0340–P0349)',
  broader: 'sensors_engine',
  narrower: [],
  related: ['timing_correlation', 'vvt'],
  dtcs: ['P0340-P0349'],
  conditionIds: [],
};

const SENSOR_KNOCK: SkosConceptNode = {
  id: 'sensor_knock',
  label: 'Knock Sensor (P0325–P0334)',
  broader: 'sensors_engine',
  narrower: [],
  related: ['misfire_random', 'ignition'],
  dtcs: ['P0325-P0334'],
  conditionIds: [],
};

const THROTTLE: SkosConceptNode = {
  id: 'throttle',
  label: 'Throttle body / pedal position sensor (P0120/P0221)',
  broader: 'sensors_engine',
  narrower: [],
  related: ['fuel_mixture', 'sensor_maf'],
  dtcs: ['P0120-P0124', 'P0221-P0229'],
  conditionIds: [],
};

const TURBO: SkosConceptNode = {
  id: 'turbo',
  label: 'Turbocharger / supercharger (P0234/P0299)',
  broader: 'powertrain',
  narrower: [],
  related: ['fuel_delivery', 'sensor_maf'],
  dtcs: ['P0234', 'P0299'],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Powertrain — Transmission branch
// ---------------------------------------------------------------------------

const TRANSMISSION: SkosConceptNode = {
  id: 'transmission',
  label: 'Transmission control',
  broader: 'powertrain',
  narrower: [],
  related: ['sensor_speed'],
  dtcs: ['P0700'],
  conditionIds: [],
};

// ---------------------------------------------------------------------------
// Live condition concepts (non-DTC, from real-time parameters)
// ---------------------------------------------------------------------------

const LIVE_OVERHEAT: SkosConceptNode = {
  id: 'live_overheat',
  label: 'Live condition — Engine overheating',
  broader: 'sensors_engine',
  narrower: [],
  related: ['sensor_temperature'],
  dtcs: [],
  conditionIds: ['cond-overheat'],
};

const LIVE_VOLTAGE: SkosConceptNode = {
  id: 'live_voltage',
  label: 'Live condition — Low battery / charging voltage',
  broader: 'powertrain',
  narrower: [],
  related: [],
  dtcs: ['P0562'],
  conditionIds: ['cond-voltage'],
};

const LIVE_OIL: SkosConceptNode = {
  id: 'live_oil',
  label: 'Live condition — Low engine oil pressure',
  broader: 'powertrain',
  narrower: [],
  related: ['vvt', 'timing_correlation'],
  dtcs: [],
  conditionIds: ['cond-oil-pressure'],
};

const LIVE_RPM: SkosConceptNode = {
  id: 'live_rpm',
  label: 'Live condition — Abnormal engine RPM',
  broader: 'powertrain',
  narrower: [],
  related: ['fuel_mixture', 'ignition'],
  dtcs: [],
  conditionIds: ['cond-rpm'],
};

// ---------------------------------------------------------------------------
// Concept index
// ---------------------------------------------------------------------------

export const OBD_ONTOLOGY: readonly SkosConceptNode[] = [
  ROOT_POWERTRAIN,
  ROOT_BODY,
  ROOT_CHASSIS,
  ROOT_NETWORK,
  // Ignition
  IGNITION,
  MISFIRE_RANDOM,
  MISFIRE_CYLINDER,
  VVT,
  TIMING_CORRELATION,
  // Fuel
  FUEL_SYSTEM,
  FUEL_MIXTURE,
  FUEL_LEAN,
  FUEL_RICH,
  FUEL_DELIVERY,
  FUEL_INJECTORS,
  // Emissions
  EMISSIONS,
  CATALYST,
  EVAP,
  EGR,
  // Sensors
  SENSORS_ENGINE,
  SENSOR_TEMPERATURE,
  SENSOR_SPEED,
  SENSOR_O2,
  SENSOR_MAF,
  SENSOR_CRANK,
  SENSOR_CAM,
  SENSOR_KNOCK,
  THROTTLE,
  // Turbo
  TURBO,
  // Transmission
  TRANSMISSION,
  // Live conditions
  LIVE_OVERHEAT,
  LIVE_VOLTAGE,
  LIVE_RPM,
  LIVE_OIL,
];

// Lookup map: concept id → node (O(1) access)
export const CONCEPT_MAP: Readonly<Record<string, SkosConceptNode>> =
  Object.fromEntries(OBD_ONTOLOGY.map((c) => [c.id, c]));

// Lookup map: dtc id → concept node that owns it canonically
export const DTC_TO_CONCEPT: Readonly<Record<string, SkosConceptNode>> =
  Object.fromEntries(
    OBD_ONTOLOGY.flatMap((concept) =>
      concept.dtcs.map((dtc) => [dtc, concept]),
    ),
  );

// ---------------------------------------------------------------------------
// SKOS navigation helpers
// ---------------------------------------------------------------------------

/** Returns the canonical concept for a given DTC id, or null if unmapped. */
export function conceptForDtc(dtcId: string): SkosConceptNode | null {
  return DTC_TO_CONCEPT[dtcId] ?? null;
}

/** Returns the full ancestor chain of a concept, from immediate parent to root. */
export function ancestors(conceptId: string): SkosConceptNode[] {
  const result: SkosConceptNode[] = [];
  let current = CONCEPT_MAP[conceptId];
  while (current?.broader != null) {
    const parent = CONCEPT_MAP[current.broader];
    if (!parent) break;
    result.push(parent);
    current = parent;
  }
  return result;
}

/** Returns the concept, its ancestors, and its SKOS related nodes — the full
 *  retrieval context for a given DTC. Used by the SHIMI layer to expand queries. */
export function retrievalContext(dtcId: string): SkosConceptNode[] {
  const canonical = conceptForDtc(dtcId);
  if (!canonical) return [];

  const seen = new Set<string>();
  const collect = (c: SkosConceptNode) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
  };

  collect(canonical);
  ancestors(canonical.id).forEach(collect);
  canonical.related
    .map((r) => CONCEPT_MAP[r])
    .filter((n): n is SkosConceptNode => n != null)
    .forEach(collect);

  return [...seen]
    .map((id) => CONCEPT_MAP[id])
    .filter((n): n is SkosConceptNode => n != null);
}
