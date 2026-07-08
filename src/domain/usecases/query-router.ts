// Classifies a user message as 'diagnostic' or 'general'.
//
// 'diagnostic' → starts/continues the intake case (DiagnosticIntakeSession)
// 'general'    → plain local chat (CARpsy), no case state
//
// Both paths run on-device; Claude is only reached later, when the user
// explicitly requests the senior review. Rule: any hint of DTCs, sensor
// names, or fault diagnosis = diagnostic. Everything else = general.

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
