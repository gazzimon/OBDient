// Vincario VIN Decoder API — global coverage including MERCOSUR.
// Docs: https://api.vincario.com
// Checksum: first 10 chars of SHA1(VIN|"decode"|API_KEY|SECRET_KEY)

import { sha1 } from '@/core/utils/sha1';

const API_KEY    = process.env.EXPO_PUBLIC_VINCARIO_API_KEY ?? '';
const SECRET_KEY = process.env.EXPO_PUBLIC_VINCARIO_SECRET_KEY ?? '';
const BASE_URL   = 'https://api.vincario.com/3.2';

export interface VehicleInfo {
  make:         string;
  model:        string | null;
  year:         number | null;
  manufacturer: string | null; // e.g. "General Motors De Argentina Srl"
  plantCountry: string | null;
}

interface DecodeEntry {
  label: string;
  value: string | number | null;
}

interface VincarioResponse {
  decode?: DecodeEntry[];
  error?:  string;
}

function get(entries: DecodeEntry[], label: string): string | null {
  const entry = entries.find(e => e.label === label);
  if (!entry || entry.value === null || entry.value === '') return null;
  return String(entry.value);
}

export async function fetchVehicleInfoByVin(vin: string): Promise<VehicleInfo | null> {
  if (!API_KEY || !SECRET_KEY) {
    console.warn('[Vincario] API keys not configured');
    return null;
  }

  const vinUpper  = vin.toUpperCase();
  const checksum  = sha1(`${vinUpper}|decode|${API_KEY}|${SECRET_KEY}`).substring(0, 10);
  const url       = `${BASE_URL}/${API_KEY}/${checksum}/decode/${vinUpper}.json`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: VincarioResponse;
  try {
    body = (await response.json()) as VincarioResponse;
  } catch {
    return null;
  }

  if (body.error || !body.decode) return null;

  const entries = body.decode;
  const make    = get(entries, 'Make');
  if (!make) return null;

  const yearStr = get(entries, 'Model Year');

  return {
    make,
    model:        get(entries, 'Model'),
    year:         yearStr ? parseInt(yearStr, 10) : null,
    manufacturer: get(entries, 'Manufacturer'),
    plantCountry: get(entries, 'Plant Country'),
  };
}
