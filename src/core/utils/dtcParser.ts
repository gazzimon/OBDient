// Parses raw OBD-II mode 03 (Read DTCs) hex responses into structured trouble codes.
// DTC format per SAE J2012: first nibble encodes system (P/B/C/U),
// remaining digits form the numeric code.

export type DtcSystem = 'P' | 'B' | 'C' | 'U';
export type DtcSeverity = 'critical' | 'warning' | 'info';

export interface ParsedDtc {
  readonly code: string;       // e.g. "P0300"
  readonly system: DtcSystem;
  readonly description: string;
  readonly severity: DtcSeverity;
}

// Maps the two high bits of the first DTC byte to the system letter
const SYSTEM_MAP: Readonly<Record<number, DtcSystem>> = {
  0: 'P',
  1: 'C',
  2: 'B',
  3: 'U',
};

// Converts a two-byte hex pair (e.g. "03", "00") to a DTC code string ("P0300")
function bytesToDtcCode(highByte: string, lowByte: string): string {
  const high = parseInt(highByte, 16);
  const low = parseInt(lowByte, 16);

  if (isNaN(high) || isNaN(low)) {
    throw new Error(`Invalid DTC bytes: "${highByte}" "${lowByte}"`);
  }

  // Upper 2 bits of high byte determine the system
  const systemIndex = (high >> 6) & 0x03;
  const system = SYSTEM_MAP[systemIndex] ?? 'P';

  // Lower 6 bits of high byte + full low byte = 3-digit hex code
  const numericPart = ((high & 0x3f) << 8) | low;
  const digits = numericPart.toString(16).toUpperCase().padStart(4, '0');

  return `${system}${digits}`;
}

// Assigns severity based on the DTC code range.
// These are conservative heuristics — a full DTC database lookup would be more accurate.
function classifySeverity(code: string): DtcSeverity {
  const numeric = parseInt(code.slice(1), 16);

  // P0 series: powertrain generic — most are warnings, some are critical
  if (code.startsWith('P0')) {
    // Misfire, fuel system, O2 sensor, catalyst codes → warning/critical
    if (numeric >= 0x0100 && numeric <= 0x0199) return 'critical'; // fuel/air metering
    if (numeric >= 0x0300 && numeric <= 0x0399) return 'critical'; // misfire
    if (numeric >= 0x0A00 && numeric <= 0x0AFF) return 'critical'; // control module
    return 'warning';
  }
  // B/C/U codes: body, chassis, network — usually informational
  if (code.startsWith('B') || code.startsWith('C') || code.startsWith('U')) {
    return 'info';
  }
  return 'warning';
}

// Minimal built-in descriptions for the most common OBD-II codes.
// The LLM layer provides richer explanations at runtime.
const COMMON_DTC_DESCRIPTIONS: Readonly<Record<string, string>> = {
  P0100: 'Mass Air Flow Circuit Malfunction',
  P0101: 'MAF Circuit Range/Performance',
  P0102: 'MAF Circuit Low Input',
  P0103: 'MAF Circuit High Input',
  P0105: 'MAP/Baro Circuit Malfunction',
  P0110: 'Intake Air Temperature Circuit Malfunction',
  P0115: 'Engine Coolant Temperature Circuit Malfunction',
  P0120: 'Throttle Position Sensor Circuit Malfunction',
  P0121: 'TPS Circuit Range/Performance',
  P0130: 'O2 Sensor Circuit (Bank 1 Sensor 1)',
  P0131: 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)',
  P0171: 'System Too Lean (Bank 1)',
  P0172: 'System Too Rich (Bank 1)',
  P0201: 'Injector Circuit Malfunction — Cylinder 1',
  P0202: 'Injector Circuit Malfunction — Cylinder 2',
  P0203: 'Injector Circuit Malfunction — Cylinder 3',
  P0204: 'Injector Circuit Malfunction — Cylinder 4',
  P0300: 'Random/Multiple Cylinder Misfire Detected',
  P0301: 'Cylinder 1 Misfire Detected',
  P0302: 'Cylinder 2 Misfire Detected',
  P0303: 'Cylinder 3 Misfire Detected',
  P0304: 'Cylinder 4 Misfire Detected',
  P0325: 'Knock Sensor Circuit Malfunction (Bank 1)',
  P0335: 'Crankshaft Position Sensor Circuit Malfunction',
  P0340: 'Camshaft Position Sensor Circuit Malfunction',
  P0400: 'EGR Flow Malfunction',
  P0420: 'Catalyst System Efficiency Below Threshold (Bank 1)',
  P0440: 'Evaporative Emission Control System Malfunction',
  P0442: 'EVAP System Small Leak Detected',
  P0455: 'EVAP System Large Leak Detected',
  P0500: 'Vehicle Speed Sensor Malfunction',
  P0505: 'Idle Control System Malfunction',
  P0600: 'Serial Communication Link Malfunction',
  P0700: 'Transmission Control System Malfunction',
  P0740: 'Torque Converter Clutch Circuit Malfunction',
};

function describeCode(code: string): string {
  return COMMON_DTC_DESCRIPTIONS[code] ?? `Fault code ${code} — diagnosis required`;
}

// Parses the raw hex string from a mode 03 response.
// Input example: "43 03 02 01 00 00 00 00 00 00"
// "43" = mode 03 response header, followed by pairs of DTC bytes.
// Returns an empty array if no DTCs are stored ("43 00").
export function parseDtcResponse(rawResponse: string): ParsedDtc[] {
  const cleaned = rawResponse
    .replace(/[\r\n>]/g, '')
    .trim()
    .toUpperCase();

  const bytes = cleaned.split(/\s+/).filter(Boolean);

  // Response header is "43", first data byte is the number of DTCs
  if (bytes.length < 2 || bytes[0] !== '43') {
    return [];
  }

  const dtcCount = parseInt(bytes[1] ?? '0', 16);
  if (dtcCount === 0) return [];

  const dtcs: ParsedDtc[] = [];
  // DTC pairs start at index 2
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    const high = bytes[i];
    const low = bytes[i + 1];
    if (high === undefined || low === undefined) break;
    // "0000" is a placeholder — skip it
    if (high === '00' && low === '00') continue;

    const code = bytesToDtcCode(high, low);
    dtcs.push({
      code,
      system: code[0] as DtcSystem,
      description: describeCode(code),
      severity: classifySeverity(code),
    });
  }

  return dtcs;
}
