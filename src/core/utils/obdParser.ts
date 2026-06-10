// Converts raw ELM327 hex responses into real-world numeric values.
// Each formula mirrors the official OBD-II SAE J1979 specification.
// Input strings are the raw adapter response AFTER stripping the echo,
// prompt character ('>'), and mode/PID header bytes.

import type { PidId } from '@/core/constants/pids';

// Extracts data bytes from a cleaned ELM327 response line.
// Expected input: "41 0C 1A F8" → ["1A", "F8"]
// The first two bytes (41 = response mode, PID byte) are skipped.
function extractDataBytes(response: string): string[] {
  const cleaned = response
    .replace(/[\r\n>]/g, '')
    .trim()
    .toUpperCase();
  const bytes = cleaned.split(/\s+/);
  // Skip mode byte (41) and PID byte
  return bytes.slice(2);
}

// Parses a single hex byte string into an integer
function byteToInt(hex: string): number {
  const value = parseInt(hex, 16);
  if (isNaN(value)) {
    throw new Error(`Invalid hex byte: "${hex}"`);
  }
  return value;
}

// --- Individual PID parsers ---

// 010C — Engine RPM: ((A*256)+B)/4 → rpm
function parseRpm(response: string): number {
  const [a, b] = extractDataBytes(response);
  if (a === undefined || b === undefined) throw new Error('RPM: missing bytes');
  return (byteToInt(a) * 256 + byteToInt(b)) / 4;
}

// 010D — Vehicle Speed: A → km/h
function parseSpeed(response: string): number {
  const [a] = extractDataBytes(response);
  if (a === undefined) throw new Error('SPEED: missing byte');
  return byteToInt(a);
}

// 0105 — Coolant Temperature: A-40 → °C
function parseCoolantTemp(response: string): number {
  const [a] = extractDataBytes(response);
  if (a === undefined) throw new Error('COOLANT_TEMP: missing byte');
  return byteToInt(a) - 40;
}

// 0104 — Engine Load: A*100/255 → %
function parseEngineLoad(response: string): number {
  const [a] = extractDataBytes(response);
  if (a === undefined) throw new Error('ENGINE_LOAD: missing byte');
  return (byteToInt(a) * 100) / 255;
}

// 0110 — Mass Air Flow: ((A*256)+B)/100 → g/s
function parseMaf(response: string): number {
  const [a, b] = extractDataBytes(response);
  if (a === undefined || b === undefined) throw new Error('MAF: missing bytes');
  return (byteToInt(a) * 256 + byteToInt(b)) / 100;
}

// 0111 — Throttle Position: A*100/255 → %
function parseTps(response: string): number {
  const [a] = extractDataBytes(response);
  if (a === undefined) throw new Error('TPS: missing byte');
  return (byteToInt(a) * 100) / 255;
}

// 010F — Intake Air Temperature: A-40 → °C
function parseIat(response: string): number {
  const [a] = extractDataBytes(response);
  if (a === undefined) throw new Error('IAT: missing byte');
  return byteToInt(a) - 40;
}

// ATRV — Battery Voltage: parseFloat response string like "12.3V" → V
function parseVoltage(response: string): number {
  const cleaned = response.replace(/[\r\n>V]/gi, '').trim();
  const value = parseFloat(cleaned);
  if (isNaN(value)) throw new Error(`VOLTAGE: unparseable response "${response}"`);
  return value;
}

// Known ELM327 non-data responses that indicate no sensor reading
const NO_DATA_RESPONSES = new Set([
  'NODATA',
  'NO DATA',
  'ERROR',
  'UNABLETOCONNECT',
  'UNABLE TO CONNECT',
  'BUSINIT',
  'BUS INIT',
  'CANERROR',
  'CAN ERROR',
  'STOPPED',
  'SEARCHING',
]);

// Returns true if the raw response is a known error/no-data string
export function isErrorResponse(raw: string): boolean {
  const normalized = raw.replace(/\s+/g, '').toUpperCase();
  for (const err of NO_DATA_RESPONSES) {
    if (normalized.includes(err.replace(/\s+/g, ''))) return true;
  }
  return false;
}

// Dispatches parsing to the correct formula based on PID id.
// Returns the numeric value rounded to 2 decimal places.
export function parsePidResponse(pidId: PidId, rawResponse: string): number {
  if (isErrorResponse(rawResponse)) {
    throw new Error(`No data from adapter for PID ${pidId}`);
  }

  let value: number;

  switch (pidId) {
    case 'RPM':
      value = parseRpm(rawResponse);
      break;
    case 'SPEED':
      value = parseSpeed(rawResponse);
      break;
    case 'COOLANT_TEMP':
      value = parseCoolantTemp(rawResponse);
      break;
    case 'ENGINE_LOAD':
      value = parseEngineLoad(rawResponse);
      break;
    case 'MAF':
      value = parseMaf(rawResponse);
      break;
    case 'TPS':
      value = parseTps(rawResponse);
      break;
    case 'IAT':
      value = parseIat(rawResponse);
      break;
    case 'VOLTAGE':
      value = parseVoltage(rawResponse);
      break;
  }

  return Math.round(value * 100) / 100;
}
