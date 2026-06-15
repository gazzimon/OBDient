// Queries the NHTSA vPIC public API to decode a VIN into make / model / year.
// No API key required. Covers vehicles manufactured in US, Mexico, and Canada.
// Endpoint: https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/{VIN}?format=json

export interface VehicleInfo {
  make: string;
  model: string;
  year: number | null;
}

interface NhtsaResult {
  Variable: string;
  Value: string | null;
}

interface NhtsaResponse {
  Results: NhtsaResult[];
}

export async function fetchVehicleInfoByVin(vin: string): Promise<VehicleInfo | null> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: NhtsaResponse;
  try {
    body = (await response.json()) as NhtsaResponse;
  } catch {
    return null;
  }

  const get = (variable: string): string | null =>
    body.Results.find(r => r.Variable === variable)?.Value ?? null;

  const make  = get('Make');
  const model = get('Model');
  const yearStr = get('Model Year');

  // NHTSA returns empty strings or "0" for unknown fields
  if (!make || make === '0' || !model || model === '0') return null;

  return {
    make:  toTitleCase(make),
    model: toTitleCase(model),
    year:  yearStr && yearStr !== '0' ? parseInt(yearStr, 10) : null,
  };
}

function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
