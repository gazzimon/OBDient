// Classifies a user message as 'diagnostic' or 'general'.
//
// 'diagnostic' → CARpsy + SHIMI/SKOS/RAG (on-device, private, no internet needed)
// 'general'    → Claude API (cloud, requires API key, no sensor data sent)
//
// Rule: any hint of DTCs, sensor names, or fault diagnosis = diagnostic.
// Everything else (explanations, how-things-work, maintenance) = general.

export type QueryType = 'diagnostic' | 'general';

// Stem-based: a leading word boundary avoids mid-word matches, but NO trailing
// boundary so Spanish plurals/inflections also match (sensor → "sensores",
// código → "códigos", batería → "baterías", voltaje → "voltajes", etc.).
// When in doubt we lean 'diagnostic' — CARpsy (on-device, has sensor data) is the
// safe default; Claude is the path we want to gate.
const DIAGNOSTIC_PATTERNS: RegExp[] = [
  /[Pp]\d{4}/,                                                   // P0300, P0171...
  /\b(dtc|c[oó]digo|code|fault|error|fallo|falla)/i,
  /\b(sensor|rpm|tps|maf|map|o2|ox[ií]geno|cataliz|catalyst)/i,
  /\b(trim|timing|ignici|mezcla|mixture|inyect|injector)/i,
  /\b(temperatur|coolant|refrigerante|bater[ií]a|battery|voltaj|voltage)/i,
  /\b(arranc|start|stall|vibra|tiembla|misfire|humo|ruido|consum)/i,
  /\b(par[aá]metro|lectura|medici|valores|diagn[oó]stic)/i,
];

export function classifyQuery(userText: string, hasDtcs: boolean): QueryType {
  if (hasDtcs) return 'diagnostic';
  if (DIAGNOSTIC_PATTERNS.some((p) => p.test(userText))) return 'diagnostic';
  return 'general';
}
