// Deterministic free-text → SymptomId matching (ADR-0009 intake / ADR-0006-A).
//
// This is NOT the embedding normalizer of ADR-0006-A Phase 3 — it is a curated
// keyword table (Spanish + English, unaccented substring match), so it stays
// 100% deterministic like the structured picker it stands in for. Misses are
// fine: the raw text still reaches the senior as owner notes; this only decides
// which structured symptom chips light up.

import { SYMPTOM_MAP } from '@/data/knowledge/symptom-ontology';

// symptom id → lowercase, unaccented substrings that indicate it.
// Keep patterns specific enough not to fire on unrelated prose.
const SYMPTOM_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  sym_hesitation: ['tironea', 'tirones', 'da tirones', 'duda al acelerar', 'hesitation', 'stumble'],
  sym_power_loss: ['falta de potencia', 'perdida de potencia', 'no tiene fuerza', 'sin fuerza', 'power loss', 'no power', 'lack of power'],
  sym_surging: ['cabecea', 'cabeceo', 'rpm sube y baja', 'surging', 'rpm oscila'],
  sym_knock_ping: ['cascabelea', 'cascabeleo del motor', 'pistonea', 'pistoneo', 'pinging'],
  sym_stall: ['se apaga', 'se para en marcha', 'se me apaga', 'stalls', 'stalling'],
  sym_harsh_shift: ['cambios bruscos', 'golpea al cambiar', 'patea la caja', 'harsh shift'],
  sym_high_consumption: ['consume mucho', 'consumo alto', 'gasta mucha nafta', 'gasta mucho combustible', 'high consumption', 'burns a lot of fuel'],
  sym_no_start: ['no arranca', 'no enciende', 'no da arranque', 'wont start', "won't start", 'does not start', 'no start'],
  sym_hard_start_cold: ['arranca mal en frio', 'cuesta arrancar en frio', 'en frio cuesta arrancar', 'hard start when cold', 'hard cold start'],
  sym_hard_start_hot: ['arranca mal en caliente', 'cuesta arrancar en caliente', 'hard start when hot', 'hard hot start'],
  sym_long_crank: ['gira mucho antes de arrancar', 'tarda en arrancar', 'da vueltas antes de arrancar', 'long crank'],
  sym_rough_idle: ['ralenti inestable', 'tiembla en ralenti', 'vibra en ralenti', 'tiembla', 'vibra parado', 'rough idle', 'shaky idle'],
  sym_high_idle: ['ralenti alto', 'queda acelerado', 'acelerado en ralenti', 'high idle'],
  sym_low_idle: ['ralenti bajo', 'se ahoga', 'low idle'],
  sym_engine_knock_noise: ['golpeteo', 'golpea el motor', 'ruido metalico', 'knocking noise', 'metallic noise'],
  sym_hiss_vacuum: ['silbido', 'soplido', 'chistido', 'hissing', 'vacuum leak'],
  sym_exhaust_rattle: ['ruido en el escape', 'cascabeleo en el escape', 'matraquea', 'exhaust rattle'],
  sym_smell_fuel: ['olor a nafta', 'olor a combustible', 'olor a gasolina', 'huele a nafta', 'huele a combustible', 'huele a gasolina', 'fuel smell', 'smells like gas'],
  sym_smell_burning: ['olor a quemado', 'huele a quemado', 'burning smell', 'smells burnt'],
  sym_smell_sulfur: ['olor a azufre', 'huele a azufre', 'huevo podrido', 'rotten egg', 'sulfur smell'],
  sym_smell_coolant: ['olor dulce', 'huele dulce', 'olor a refrigerante', 'huele a refrigerante', 'coolant smell', 'sweet smell'],
  sym_smoke_white: ['humo blanco', 'white smoke'],
  sym_smoke_blue: ['humo azul', 'quema aceite', 'blue smoke', 'burns oil'],
  sym_smoke_black: ['humo negro', 'black smoke'],
  sym_coolant_leak: ['pierde refrigerante', 'perdida de refrigerante', 'pierde agua', 'coolant leak', 'leaks coolant'],
  sym_oil_leak: ['pierde aceite', 'perdida de aceite', 'mancha de aceite', 'oil leak', 'leaks oil'],
  sym_fuel_leak: ['pierde nafta', 'pierde combustible', 'fuel leak', 'leaks fuel'],
  sym_overheating: ['recalienta', 'sobrecalienta', 'levanta temperatura', 'se calienta mucho', 'overheat', 'aguja alta', 'temperature runs high'],
  sym_no_warmup: ['no calienta', 'tarda en calentar', 'no levanta temperatura', 'never warms up'],
  sym_dim_flicker_lights: ['luces tenues', 'parpadean las luces', 'luces parpadean', 'lights flicker', 'dim lights'],
  sym_battery_drain: ['se descarga la bateria', 'bateria se descarga', 'me deja sin bateria', 'battery drains', 'battery drain'],
  sym_accessory_fault: ['falla la electronica', 'fallan los accesorios', 'accessories fail'],
  sym_cel_flashing: ['check engine titila', 'titila el check', 'parpadea el check', 'check parpadea', 'cel flashing', 'check engine flashing', 'check engine light flashing'],
  sym_temp_light: ['luz de temperatura', 'testigo de temperatura', 'temperature light'],
  sym_oil_light: ['luz de aceite', 'testigo de aceite', 'oil light', 'oil pressure light'],
  sym_battery_light: ['luz de bateria', 'testigo de bateria', 'battery light', 'charging light'],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Negators that, appearing right before a symptom keyword, flip it to DENIED
// ("no tira humo blanco" is negative evidence — ADR-0006-A LAMBDA_ABSENT).
const NEGATORS = ['no', 'ni', 'nunca', 'sin', 'tampoco', 'not', 'never', "doesn't", 'doesnt', "don't", 'dont'];
// How far back (chars) a negator still governs the keyword
const NEGATION_WINDOW = 16;

export interface SymptomMatchResult {
  readonly confirmed: readonly string[];
  readonly denied: readonly string[];
}

function isNegated(haystack: string, keywordIndex: number): boolean {
  const windowStart = Math.max(0, keywordIndex - NEGATION_WINDOW);
  const window = haystack.slice(windowStart, keywordIndex);
  // A sentence break between negator and keyword cancels the negation
  if (/[.;!?]/.test(window)) return false;
  const words = window.split(/\s+/).filter(Boolean);
  return words.some((w) => NEGATORS.includes(w));
}

/** Symptom ids whose keywords appear in the text, split into confirmed vs
 *  denied by a preceding negator. Deterministic; empty text → both empty. */
export function matchSymptomsDetailed(text: string): SymptomMatchResult {
  const haystack = normalize(text);
  if (haystack.length === 0) return { confirmed: [], denied: [] };

  const confirmed: string[] = [];
  const denied: string[] = [];
  for (const [symptomId, keywords] of Object.entries(SYMPTOM_KEYWORDS)) {
    if (SYMPTOM_MAP[symptomId] == null) continue; // guard against table drift
    let sawConfirmed = false;
    let sawDenied = false;
    for (const keyword of keywords) {
      const idx = haystack.indexOf(keyword);
      if (idx === -1) continue;
      if (isNegated(haystack, idx)) sawDenied = true;
      else sawConfirmed = true;
    }
    // An affirmation anywhere outweighs a denial of another phrasing
    if (sawConfirmed) confirmed.push(symptomId);
    else if (sawDenied) denied.push(symptomId);
  }
  return { confirmed, denied };
}

/** Confirmed-only view (backward compatible). */
export function matchSymptoms(text: string): string[] {
  return [...matchSymptomsDetailed(text).confirmed];
}
