// Parses the raw ELM327 response for OBD-II mode 09 PID 02 (VIN request).
//
// ISO 15765-4 CAN frames are reassembled by the ELM327 before we see them.
// The response arrives as a hex dump, potentially with frame-line prefixes
// (0: 1: 2:) when ATFCSH/multi-frame formatting is active. We strip those,
// collect all hex bytes, locate the 49 02 header, and extract the 17 VIN chars.

export function parseVinResponse(raw: string): string | null {
  // Strip ISO 15765 frame-line prefixes (0: 1: 2: ...) produced by ELM327
  const stripped = raw.replace(/\d+:\s*/g, ' ');

  // Collect only valid 2-char hex tokens
  const bytes = stripped
    .split(/\s+/)
    .filter(tok => /^[0-9A-Fa-f]{2}$/.test(tok));

  // Locate response header: 49 02 [count]
  const upper = bytes.map(b => b.toUpperCase());
  const idx = upper.findIndex((b, i) => b === '49' && upper[i + 1] === '02');
  if (idx === -1) return null;

  // Skip 49, 02, count byte → 17 ASCII bytes follow
  const vinBytes = bytes.slice(idx + 3, idx + 3 + 17);
  if (vinBytes.length < 17) return null;

  const vin = vinBytes.map(b => String.fromCharCode(parseInt(b, 16))).join('');

  // ISO 3779: 17 alphanumeric chars, letters I / O / Q are excluded
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;

  return vin.toUpperCase();
}
