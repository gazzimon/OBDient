// Deterministic make/model/year/engine extraction from a free-text user reply
// ("chevrolet corsa 1.6 2008"). ADR-0009 Phase 1 input path: the local model
// asks the question, THIS parser (not the LLM) extracts the structured fields,
// and the user confirms — the LLM never decides what the vehicle is.
//
// Pure and table-testable. Unknown fields come back null; the intake state
// machine re-asks for whatever is missing.

export interface ParsedVehicleIdentity {
  readonly make: string | null;   // canonical name, e.g. "Chevrolet"
  readonly model: string | null;  // as typed, capitalized, e.g. "Corsa"
  readonly year: number | null;
  readonly engine: string | null; // displacement as typed, e.g. "1.6"
}

// Canonical make → accepted aliases (lowercase, unaccented).
// LatAm-market-heavy list; extend freely — matching is exact per token.
const MAKE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'Chevrolet': ['chevrolet', 'chevy', 'chev'],
  'Volkswagen': ['volkswagen', 'vw'],
  'Ford': ['ford'],
  'Fiat': ['fiat'],
  'Renault': ['renault'],
  'Peugeot': ['peugeot'],
  'Citroën': ['citroen'],
  'Toyota': ['toyota'],
  'Honda': ['honda'],
  'Nissan': ['nissan'],
  'Hyundai': ['hyundai'],
  'Kia': ['kia'],
  'Suzuki': ['suzuki'],
  'Mitsubishi': ['mitsubishi'],
  'Mazda': ['mazda'],
  'Subaru': ['subaru'],
  'BMW': ['bmw'],
  'Mercedes-Benz': ['mercedes', 'mercedes-benz', 'benz'],
  'Audi': ['audi'],
  'SEAT': ['seat'],
  'Škoda': ['skoda'],
  'Dodge': ['dodge'],
  'Jeep': ['jeep'],
  'RAM': ['ram'],
  'Chery': ['chery'],
  'Chrysler': ['chrysler'],
  'Isuzu': ['isuzu'],
  'Daihatsu': ['daihatsu'],
  'Opel': ['opel'],
  'Alfa Romeo': ['alfa', 'alfa-romeo'],
  'Volvo': ['volvo'],
  'Land Rover': ['land-rover', 'landrover'],
  'Lexus': ['lexus'],
  'Lifan': ['lifan'],
  'Great Wall': ['great-wall', 'greatwall'],
  'BYD': ['byd'],
  'Geely': ['geely'],
  'DFSK': ['dfsk'],
  'JAC': ['jac'],
  'Haval': ['haval'],
};

const ALIAS_TO_MAKE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MAKE_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((a) => [a, canonical]),
  ),
);

// Model years: 1980–2049, 4 digits only (2-digit shorthand is ambiguous — re-ask)
const YEAR_4 = /^(19[89]\d|20[0-4]\d)$/;
// Engine displacement: 1.0–9.9, comma or dot decimal ("1.6", "1,6", "2.0i" no)
const ENGINE = /^(\d[.,]\d)$/;
// Noise words the user may include in the reply
const STOPWORDS = new Set([
  'es', 'un', 'una', 'el', 'la', 'mi', 'del', 'de', 'ano', 'año', 'modelo',
  'marca', 'motor', 'tengo', 'auto', 'coche', 'carro', 'camioneta', 'vehiculo',
  'a', 'an', 'the', 'my', 'year', 'model', 'make', 'engine', 'car', 'truck', 'its', 'it',
]);

function stripAccents(s: string): string {
  // Strip combining diacritical marks left over after NFD decomposition
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : (s[0] ?? '').toUpperCase() + s.slice(1);
}

export function parseVehicleIdentity(text: string): ParsedVehicleIdentity {
  const tokens = stripAccents(text.toLowerCase())
    .replace(/(\d),(\d)/g, '$1.$2') // decimal comma ("1,6") before punctuation cleanup
    .replace(/[,;:!?()"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let make: string | null = null;
  let year: number | null = null;
  let engine: string | null = null;
  const modelTokens: string[] = [];
  let makeIndex = -1;

  tokens.forEach((token, i) => {
    if (make == null && ALIAS_TO_MAKE[token] != null) {
      make = ALIAS_TO_MAKE[token] ?? null;
      makeIndex = i;
      return;
    }
    if (year == null && YEAR_4.test(token)) {
      year = parseInt(token, 10);
      return;
    }
    const engineMatch = ENGINE.exec(token);
    if (engine == null && engineMatch?.[1] != null) {
      engine = engineMatch[1].replace(',', '.');
      return;
    }
    if (STOPWORDS.has(token)) return;
    // Candidate model token: alphanumeric word that is none of the above.
    // Only tokens AFTER the make count when a make was found ("corsa chevrolet"
    // still works because make may appear later — see second pass below).
    if (/^[a-z0-9][a-z0-9-]*$/.test(token)) {
      modelTokens.push(`${i}:${token}`);
    }
  });

  // Model heuristic: first 1–2 candidate tokens after the make; if no make was
  // found (or it came after the model), fall back to the first candidates.
  const afterMake = modelTokens
    .map((t) => {
      const sep = t.indexOf(':');
      return { i: parseInt(t.slice(0, sep), 10), word: t.slice(sep + 1) };
    })
    .filter((t) => makeIndex === -1 || t.i > makeIndex);
  const pool = afterMake.length > 0
    ? afterMake
    : modelTokens.map((t) => {
        const sep = t.indexOf(':');
        return { i: parseInt(t.slice(0, sep), 10), word: t.slice(sep + 1) };
      });

  const model = pool.length > 0
    ? pool.slice(0, 2).map((t) => capitalize(t.word)).join(' ')
    : null;

  return { make, model, year, engine };
}
