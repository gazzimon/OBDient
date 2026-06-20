// Classifies a user message as 'diagnostic' or 'general'.
//
// 'diagnostic' → CARpsy + SHIMI/SKOS/RAG (on-device, private, no internet needed)
// 'general'    → Claude API (cloud, requires API key, no sensor data sent)
//
// Rule: any hint of DTCs, sensor names, or fault diagnosis = diagnostic.
// Everything else (explanations, how-things-work, maintenance) = general.

export type QueryType = 'diagnostic' | 'general';

const DIAGNOSTIC_PATTERNS: RegExp[] = [
  /[Pp]\d{4}/,                     // P0300, P0171, etc.
  /\b(DTC|código|code|fault|error|fallo|falla)\b/i,
  /\b(sensor|RPM|rpm|TPS|MAF|MAP|O2|oxígeno|oxigeno|catalizador|catalyst)\b/i,
  /\b(trim|timing|ignición|ignicion|mezcla|mixture|inyector|injector)\b/i,
  /\b(temperatura|temperature|coolant|refrigerante|batería|battery|voltaje|voltage)\b/i,
  /\b(arrancar|starting|stall|vibra|vibrat|tiembla|misfire)\b/i,
];

export function classifyQuery(userText: string, hasDtcs: boolean): QueryType {
  if (hasDtcs) return 'diagnostic';
  if (DIAGNOSTIC_PATTERNS.some((p) => p.test(userText))) return 'diagnostic';
  return 'general';
}
