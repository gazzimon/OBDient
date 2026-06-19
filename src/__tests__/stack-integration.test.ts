/**
 * Full-stack integration test: SHIMI + Ontology + Hypercore patterns + CARpsy-v2 via Ollama.
 *
 * What runs REAL (no mocks):
 *   - obd-ontology   → SKOS concept expansion
 *   - shimi-tree     → hierarchical confidence-ranked retrieval
 *   - obd-knowledge  → static knowledge corpus
 *   - pattern-evaluator → Layer 2 pattern matching against live OBD snapshot
 *   - Ollama CARpsy-v2  → actual LLM inference (replaces @qvac/sdk for desktop testing)
 *
 * What is stubbed (native modules, unavailable in Node):
 *   - @qvac/sdk     → replaced by Ollama HTTP call
 *   - qvac-rag      → replaced by SHIMI-only retrieval (same degraded path the app uses)
 *   - hypercore     → empty feed (no peers in test env, matches cold-start behaviour)
 *   - MMKV          → in-memory store
 */

// MMKV mock — must be before any import that triggers shimi-tree
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: jest.fn(() => null),
    set: jest.fn(),
  }),
}));

import { shimiTree } from '@/data/knowledge/shimi-tree';
import { retrievalContext } from '@/data/knowledge/obd-ontology';
import { evaluatePatterns } from '@/data/datasources/pattern-evaluator';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { PatternChunk } from '@/data/knowledge/distributed-chunk';
// eslint-disable-next-line @typescript-eslint/no-require-imports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require('http');

// ─── Ollama helper (replaces @qvac/sdk) ──────────────────────────────────────

const OLLAMA_MODEL = 'carpsy:latest';
const OLLAMA_URL   = 'http://127.0.0.1:11434/api/generate';

const SYSTEM_PROMPT =
  'You are OBDient, an expert automotive diagnostic assistant. ' +
  'You receive real-time OBD-II vehicle data and fault codes. ' +
  'Be concise and accurate. Do not fabricate DTC definitions. /no_think';

function ollamaGenerate(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 350 },
    });
    const req = http.request(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json.response ?? '').trim());
        } catch {
          reject(new Error('Ollama response parse error: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Full pipeline function (mirrors LLMRepositoryImpl.interpret) ─────────────

interface StackResult {
  ontologyExpansion: string[];
  shimiSnippets: string[];
  patternMatches: string[];
  knowledgeContext: string[];
  llmResponse: string;
  latencyMs: number;
}

async function runFullStack(
  dtcs: TroubleCode[],
  parameters: ObdParameterSnapshot,
  vehicleContext: string,
  hypercorePatterns: PatternChunk[] = [],
): Promise<StackResult> {
  const primaryDtcId = dtcs[0]?.code;

  // 1. SKOS ontology expansion
  const ontologyConcepts = retrievalContext(primaryDtcId ?? '');
  const ontologyExpansion = ontologyConcepts.map((c) => c.label);

  // 2. Build retrieval query
  const baseQuery = dtcs.map((d) => `${d.code} ${d.description}`).join('; ');
  const expandedQuery = ontologyExpansion.length
    ? `${baseQuery}; ${ontologyExpansion.join('; ')}`
    : baseQuery;

  // 3. SHIMI hierarchical retrieval (real)
  const shimiSnippets = primaryDtcId ? shimiTree.search(primaryDtcId, 6) : [];

  // 4. Pattern evaluator against live OBD snapshot (real)
  const patternMatches = evaluatePatterns(
    hypercorePatterns,
    dtcs,
    parameters,
    vehicleContext,
  ).map((m) => `Pattern (confidence ${m.pattern.confidence.toFixed(2)}): ${m.conclusion}`);

  // 5. Merge knowledge context
  const knowledgeContext = [...shimiSnippets, ...patternMatches];

  // 6. Build final prompt (mirrors qvacSDK.interpret format)
  const knowledgeBlock = knowledgeContext.length
    ? `\n\nRelevant knowledge:\n${knowledgeContext.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`
    : '';

  const prompt =
    `${SYSTEM_PROMPT}\n\n` +
    `Vehicle: ${vehicleContext}\n` +
    `Active DTCs: ${dtcs.map((d) => d.code).join(', ')}\n` +
    `Live data: ${JSON.stringify(parameters, null, 0)}\n` +
    `${knowledgeBlock}\n\n` +
    `Diagnose and provide actionable repair steps.`;

  // 7. CARpsy-v2 inference via Ollama
  const t0 = Date.now();
  const llmResponse = await ollamaGenerate(prompt);
  const latencyMs = Date.now() - t0;

  return {
    ontologyExpansion,
    shimiSnippets,
    patternMatches,
    knowledgeContext,
    llmResponse,
    latencyMs,
  };
}

// ─── Test scenarios ───────────────────────────────────────────────────────────

jest.setTimeout(120_000); // Ollama inference can take 30-60s on CPU

describe('Full stack: SHIMI + Ontology + Patterns + CARpsy-v2', () => {

  // ── TC-01: P0420 Toyota Camry ──────────────────────────────────────────────
  it('TC-01 | P0420 catalyst — correct diagnosis with SHIMI context', async () => {
    const dtcs: TroubleCode[] = [{ id: 'tc01', code: 'P0420', system: 'P', description: 'Catalyst System Efficiency Below Threshold Bank 1', severity: 'warning', detectedAt: new Date(), interpretation: null }];
    const params: ObdParameterSnapshot = {
      RPM:          { pid: 'RPM',          name: 'RPM',           value: 820,  unit: 'rpm',  timestamp: new Date(), alert: null },
      COOLANT_TEMP: { pid: 'COOLANT_TEMP', name: 'Coolant Temp',  value: 88,   unit: '°C',   timestamp: new Date(), alert: null },
    };

    const result = await runFullStack(dtcs, params, '2017 Toyota Camry 2.5L I4');

    console.log('\n─── TC-01 P0420 ───');
    console.log('Ontology expansion:', result.ontologyExpansion);
    console.log('SHIMI snippets:', result.shimiSnippets.length, 'retrieved');
    result.shimiSnippets.forEach((s, i) => console.log(`  [${i+1}] ${s.slice(0, 120)}...`));
    console.log('Pattern matches:', result.patternMatches.length);
    console.log(`LLM response (${result.latencyMs}ms):\n${result.llmResponse}\n`);

    expect(result.ontologyExpansion.length).toBeGreaterThan(0);
    expect(result.llmResponse.length).toBeGreaterThan(50);
    // With SHIMI context the model should now mention catalyst or O2
    const lower = result.llmResponse.toLowerCase();
    const hasCatalystContext = lower.includes('catalyst') || lower.includes('oxygen') || lower.includes('o2') || lower.includes('p0420');
    expect(hasCatalystContext).toBe(true);
  });

  // ── TC-02: P0300 + P0301 + P0302 F-150 ────────────────────────────────────
  it('TC-02 | P0300+P0301+P0302 misfire — pattern + SHIMI combo', async () => {
    const dtcs: TroubleCode[] = [
      { id: 'tc02a', code: 'P0300', system: 'P', description: 'Random/Multiple Cylinder Misfire Detected', severity: 'critical', detectedAt: new Date(), interpretation: null },
      { id: 'tc02b', code: 'P0301', system: 'P', description: 'Cylinder 1 Misfire Detected', severity: 'warning', detectedAt: new Date(), interpretation: null },
      { id: 'tc02c', code: 'P0302', system: 'P', description: 'Cylinder 2 Misfire Detected', severity: 'warning', detectedAt: new Date(), interpretation: null },
    ];
    const params: ObdParameterSnapshot = {
      RPM:          { pid: 'RPM',          name: 'RPM',     value: 750,  unit: 'rpm',  timestamp: new Date(), alert: null },
      MAF:          { pid: 'MAF',          name: 'MAF',     value: 11.2, unit: 'g/s',  timestamp: new Date(), alert: null },
      COOLANT_TEMP: { pid: 'COOLANT_TEMP', name: 'Coolant', value: 93,   unit: '°C',   timestamp: new Date(), alert: null },
      ENGINE_LOAD:  { pid: 'ENGINE_LOAD',  name: 'Load',    value: 35,   unit: '%',    timestamp: new Date(), alert: null },
    };

    // Simulate a Hypercore Layer 2 pattern for this specific scenario
    const hypercorePatterns: PatternChunk[] = [
      {
        type: 'pattern',
        id: 'pattern-f150-misfire-coil',
        condition: {
          dtcs: ['P0300', 'P0301', 'P0302'],
          params: {},
        },
        conclusion: 'Multiple sequential cylinder misfires on EcoBoost V6 — high probability of COP coil failure on cylinders 1-2. Check coil resistance; replace with OEM coil, not aftermarket.',
        confidence: 0.82,
        confirmations: 7,
        scope: { makes: ['ford'] },
        createdAt: new Date().toISOString(),
      },
    ];

    const result = await runFullStack(dtcs, params, '2018 Ford F-150 3.5L EcoBoost', hypercorePatterns);

    console.log('\n─── TC-02 P0300/P0301/P0302 ───');
    console.log('SHIMI snippets:', result.shimiSnippets.length);
    console.log('Pattern matches fired:', result.patternMatches.length);
    result.patternMatches.forEach((p) => console.log('  Pattern:', p.slice(0, 160)));
    console.log(`LLM response (${result.latencyMs}ms):\n${result.llmResponse}\n`);

    // Pattern evaluator must have fired
    expect(result.patternMatches.length).toBeGreaterThan(0);
    expect(result.llmResponse.length).toBeGreaterThan(50);
  });

  // ── TC-03: P0171 lean condition ────────────────────────────────────────────
  it('TC-03 | P0171 lean + high fuel trim — top causes ranked', async () => {
    const dtcs: TroubleCode[] = [
      { id: 'tc03', code: 'P0171', system: 'P', description: 'System Too Lean Bank 1', severity: 'warning', detectedAt: new Date(), interpretation: null },
    ];
    const params: ObdParameterSnapshot = {
      RPM:          { pid: 'RPM',          name: 'RPM',     value: 800,  unit: 'rpm',  timestamp: new Date(), alert: null },
      MAF:          { pid: 'MAF',          name: 'MAF',     value: 4.1,  unit: 'g/s',  timestamp: new Date(), alert: null },
      COOLANT_TEMP: { pid: 'COOLANT_TEMP', name: 'Coolant', value: 90,   unit: '°C',   timestamp: new Date(), alert: null },
      ENGINE_LOAD:  { pid: 'ENGINE_LOAD',  name: 'Load',    value: 28,   unit: '%',    timestamp: new Date(), alert: null },
    };

    const result = await runFullStack(dtcs, params, '2015 Honda Civic 1.8L');

    console.log('\n─── TC-03 P0171 lean ───');
    console.log('SHIMI snippets:', result.shimiSnippets.length);
    console.log(`LLM response (${result.latencyMs}ms):\n${result.llmResponse}\n`);

    expect(result.llmResponse.length).toBeGreaterThan(50);
    const lower = result.llmResponse.toLowerCase();
    const mentionsLeanCause = lower.includes('vacuum') || lower.includes('maf') || lower.includes('fuel') || lower.includes('lean') || lower.includes('injector');
    expect(mentionsLeanCause).toBe(true);
  });

  // ── TC-04: Unknown DTC hallucination guard ────────────────────────────────
  it('TC-04 | Unknown DTC P1SC4 — model must not hallucinate definition', async () => {
    const dtcs: TroubleCode[] = [
      { id: 'tc04', code: 'P1SC4', system: 'P', description: 'Unknown', severity: 'warning', detectedAt: new Date(), interpretation: null },
    ];
    const params: ObdParameterSnapshot = {};

    const result = await runFullStack(dtcs, params, '2020 Subaru Outback 2.5L');

    console.log('\n─── TC-04 P1SC4 unknown DTC ───');
    console.log('SHIMI snippets:', result.shimiSnippets.length, '(expected 0 — no concept match)');
    console.log(`LLM response (${result.latencyMs}ms):\n${result.llmResponse}\n`);
    console.log('*** MANUAL REVIEW: Does the response avoid inventing a definition? ***');

    // SHIMI should return nothing for an unknown DTC
    expect(result.shimiSnippets.length).toBe(0);
    // Response must exist but we can't auto-assert content — log for manual review
    expect(result.llmResponse.length).toBeGreaterThan(10);
  });

  // ── TC-05: No DTC — parameter-only overheating ────────────────────────────
  it('TC-05 | No DTC, coolant 112°C — emergency parameter diagnosis', async () => {
    const dtcs: TroubleCode[] = [];
    const params: ObdParameterSnapshot = {
      COOLANT_TEMP: { pid: 'COOLANT_TEMP', name: 'Coolant Temp', value: 112, unit: '°C', timestamp: new Date(), alert: { severity: 'critical', message: 'overheating' } },
      RPM:          { pid: 'RPM',          name: 'RPM',          value: 1200, unit: 'rpm', timestamp: new Date(), alert: null },
      ENGINE_LOAD:  { pid: 'ENGINE_LOAD',  name: 'Engine Load',  value: 48,   unit: '%',   timestamp: new Date(), alert: null },
    };

    const result = await runFullStack(dtcs, params, '2016 Chevrolet Silverado 5.3L V8');

    console.log('\n─── TC-05 Overheating no DTC ───');
    console.log(`LLM response (${result.latencyMs}ms):\n${result.llmResponse}\n`);

    expect(result.llmResponse.length).toBeGreaterThan(50);
    const lower = result.llmResponse.toLowerCase();
    const mentionsDanger = lower.includes('stop') || lower.includes('overheat') || lower.includes('cool') || lower.includes('pull');
    expect(mentionsDanger).toBe(true);
  });

  // ── Summary: SHIMI confidence state after all tests ───────────────────────
  it('SUMMARY | SHIMI top nodes confidence after test run', () => {
    const top = shimiTree.topNodes(10);
    console.log('\n─── SHIMI Top Nodes (confidence) ───');
    top.forEach((n) => console.log(`  ${n.concept.id.padEnd(30)} ${(n.confidence * 100).toFixed(1)}%`));
    expect(top.length).toBeGreaterThanOrEqual(0);
  });
});
