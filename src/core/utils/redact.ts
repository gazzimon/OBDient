// Deterministic PII redaction for text that leaves the device (ADR-0009 §2).
// The data contract: vehicle data travels, the VIN and any user identity never
// do. Structured fields exclude PII by construction; this scrubs the free-text
// paths (owner notes, intake answers) with known patterns.

// 17 chars, alphanumeric excluding I/O/Q per VIN spec — matches VINs quoted in
// free text ("mi vin es 3G1SF21649S123456")
const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

// License plates: Mercosur (AB123CD / AB 123 CD) and legacy (ABC123 / ABC 123).
// Uppercase-only ON PURPOSE: with /i these match ordinary prose ("es 120 km",
// "los 300"). Plates are conventionally typed uppercase; lowercase misses are
// an accepted tradeoff over mangling technical notes.
const PLATE_PATTERNS: readonly RegExp[] = [
  /\b[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}\b/g,
  /\b[A-Z]{3}[- ]?\d{3}\b/g,
];

const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi;

// No phone redaction: digit-run patterns false-positive on technical notes
// (year lists, RPM sequences). The ADR-0009 contract covers VIN, plates and
// user identity (excluded by construction).

export const REDACTED = '[REDACTED]';

export function redactText(text: string): string {
  let out = text.replace(VIN_PATTERN, REDACTED);
  for (const plate of PLATE_PATTERNS) {
    out = out.replace(plate, REDACTED);
  }
  return out.replace(EMAIL_PATTERN, REDACTED);
}
