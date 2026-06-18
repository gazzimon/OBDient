/**
 * Paso 1 — Smoke test local de Hypercore (sin red, sin dispositivo).
 *
 * Qué prueba:
 *   1. Crear un feed writer en disco (tmpdir) y uno reader en memoria
 *   2. Escribir los tres tipos de DistributedChunk (fact, pattern, skos-patch)
 *   3. Replicar en el mismo proceso via streams pipe
 *   4. Leer y deserializar cada chunk desde el feed replicado
 *   5. Verificar que el dispatch por tipo funciona correctamente
 *   6. Verificar que el schema de confianza (QUORUM) viaja intacto
 *
 * Cómo correr:
 *   node scripts/test-hypercore-local.js
 *
 * Hypercore v11 usa async/await puro — sin callbacks ready().
 */

'use strict';

const Hypercore = require('hypercore');
const b4a      = require('b4a');
const os       = require('os');
const path     = require('path');
const fs       = require('fs');

// ---------------------------------------------------------------------------
// QUORUM (duplicado — no importamos desde RN)
// ---------------------------------------------------------------------------

const QUORUM = { fact: 3, pattern: 5, skosPatch: 10 };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const factChunk = {
  type: 'fact',
  id: 'fact-001',
  dtc: 'P0301',
  make: 'VW',
  yearRange: [2016, 2020],
  content: 'P0301 cylinder 1 misfire — check coil pack before injector on VW EA888.',
  confidence: 0.75,
  confirmations: 4,
  createdAt: new Date().toISOString(),
};

const patternChunk = {
  type: 'pattern',
  id: 'pattern-001',
  condition: {
    dtcs: ['P0299', 'P0234'],
    params: { RPM: { lt: 2000 } },
  },
  conclusion: 'Revisar actuador turbo antes de reemplazar el turbo completo.',
  scope: { makes: ['VW', 'Audi', 'Seat'], engines: ['EA288'] },
  confidence: 0.82,
  confirmations: 6,
  createdAt: new Date().toISOString(),
};

const skosPatch = {
  type: 'skos-patch',
  id: 'patch-001',
  op: 'addNarrower',
  targetConceptId: 'ignition',
  newConcept: { id: 'coil_pack_vw', label: 'Coil pack VW EA888' },
  proposedBy: 'aabbccdd00001111',
  confirmations: 11,
  createdAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    failed++;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function encode(chunk) {
  return b4a.from(JSON.stringify(chunk), 'utf8');
}

function decode(buf) {
  return JSON.parse(b4a.toString(buf, 'utf8'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n========================================');
  console.log(' OBDient — Hypercore local smoke test   ');
  console.log('========================================\n');

  const writerDir  = path.join(os.tmpdir(), 'obdient-hc-writer-'  + Date.now());
  const readerDir  = path.join(os.tmpdir(), 'obdient-hc-reader-'  + Date.now());

  // ── 1. Open writer feed ────────────────────────────────────────────────
  console.log('[ 1 ] Opening writer feed (disk)...');
  const writer = new Hypercore(writerDir);
  await writer.ready();

  assert(writer.opened === true,              'Writer feed opened');
  assert(writer.length === 0,                 'Writer starts empty');
  assert(writer.key instanceof Uint8Array,    'Writer has a public key');
  console.log(`  →   Key: ${Buffer.from(writer.key).toString('hex').slice(0, 16)}…`);

  // ── 2. Append three chunk types ────────────────────────────────────────
  console.log('\n[ 2 ] Appending FactChunk, PatternChunk, SkosPatch...');
  await writer.append(encode(factChunk));
  await writer.append(encode(patternChunk));
  await writer.append(encode(skosPatch));

  assert(writer.length === 3, `Writer has 3 entries (got ${writer.length})`);

  // ── 3. Round-trip read from writer ────────────────────────────────────
  console.log('\n[ 3 ] Round-trip: read chunks back from writer...');
  const readFact    = decode(await writer.get(0));
  const readPattern = decode(await writer.get(1));
  const readPatch   = decode(await writer.get(2));

  assert(deepEqual(readFact,    factChunk),    'FactChunk survives JSON round-trip');
  assert(deepEqual(readPattern, patternChunk), 'PatternChunk survives JSON round-trip');
  assert(deepEqual(readPatch,   skosPatch),    'SkosPatch survives JSON round-trip');

  // ── 4. Schema field integrity ──────────────────────────────────────────
  console.log('\n[ 4 ] Schema field integrity...');
  assert(readFact.type === 'fact',                          'FactChunk type discriminator intact');
  assert(readFact.dtc  === 'P0301',                         'FactChunk DTC intact');
  assert(readFact.confirmations === 4,                      'FactChunk confirmations intact');
  assert(readFact.confirmations >= QUORUM.fact,             `FactChunk meets quorum (${readFact.confirmations} >= ${QUORUM.fact})`);

  assert(readPattern.type === 'pattern',                    'PatternChunk type discriminator intact');
  assert(Array.isArray(readPattern.condition.dtcs),         'PatternChunk condition.dtcs is array');
  assert(readPattern.condition.dtcs.includes('P0299'),      'PatternChunk condition DTC P0299 intact');
  assert(readPattern.condition.params.RPM.lt === 2000,      'PatternChunk param threshold intact');
  assert(readPattern.scope.makes.includes('VW'),            'PatternChunk scope makes intact');
  assert(readPattern.confirmations >= QUORUM.pattern,       `PatternChunk meets quorum (${readPattern.confirmations} >= ${QUORUM.pattern})`);

  assert(readPatch.type === 'skos-patch',                   'SkosPatch type discriminator intact');
  assert(readPatch.op === 'addNarrower',                    'SkosPatch op intact');
  assert(readPatch.newConcept.id === 'coil_pack_vw',        'SkosPatch newConcept id intact');
  assert(readPatch.confirmations >= QUORUM.skosPatch,       `SkosPatch meets quorum (${readPatch.confirmations} >= ${QUORUM.skosPatch})`);

  // ── 5. Replicate writer → reader ──────────────────────────────────────
  console.log('\n[ 5 ] Replicating writer → reader (in-process stream pipe)...');
  const reader = new Hypercore(readerDir, writer.key);
  await reader.ready();

  assert(reader.length === 0, 'Reader starts empty before replication');

  // Pipe the two replication streams together.
  // In Hypercore v11 the stream stays open (live by default) — we don't wait
  // for close. Instead we request each block directly; the protocol fetches
  // them from the writer on demand.
  const s1 = writer.replicate(true);
  const s2 = reader.replicate(false);
  s1.on('error', () => {});
  s2.on('error', () => {});
  s1.pipe(s2).pipe(s1);

  // Request all three blocks from the reader — triggers remote fetch via the pipe.
  const [r0, r1, r2] = await Promise.all([
    reader.get(0),
    reader.get(1),
    reader.get(2),
  ]);

  s1.destroy();
  s2.destroy();

  console.log(`  →   Reader length after replication: ${reader.length}`);
  assert(reader.length === 3, `Reader replicated all 3 entries (got ${reader.length})`);
  assert(r0 != null && r1 != null && r2 != null, 'All 3 blocks received from writer');

  // ── 6. Dispatch by type from reader feed ──────────────────────────────
  console.log('\n[ 6 ] Dispatch by type from reader feed...');
  const dispatched = { fact: 0, pattern: 0, 'skos-patch': 0 };

  // Blocks already in memory from step 5 — decode directly
  for (const buf of [r0, r1, r2]) {
    const chunk = decode(buf);
    if (chunk.type in dispatched) dispatched[chunk.type]++;
  }

  assert(dispatched['fact']       === 1, `Dispatched 1 FactChunk (got ${dispatched['fact']})`);
  assert(dispatched['pattern']    === 1, `Dispatched 1 PatternChunk (got ${dispatched['pattern']})`);
  assert(dispatched['skos-patch'] === 1, `Dispatched 1 SkosPatch (got ${dispatched['skos-patch']})`);

  // ── 7. Trust registry confidence weighting ────────────────────────────
  console.log('\n[ 7 ] Confidence weighting (trust registry formula)...');
  const peerScore  = 0.3;
  const multiplier = 0.5 + 0.5 * peerScore; // lerp(0.5, 1.0, 0.3) = 0.65
  const weighted   = readFact.confidence * multiplier;

  assert(Math.abs(multiplier - 0.65) < 0.001, `Multiplier for score 0.3 = 0.65 (got ${multiplier.toFixed(4)})`);
  assert(weighted < readFact.confidence,       `Weighted confidence < base (${weighted.toFixed(4)} < ${readFact.confidence})`);
  assert(weighted > 0,                         'Weighted confidence is positive');

  // ── 8. Cleanup ────────────────────────────────────────────────────────
  await writer.close();
  await reader.close();
  fs.rmSync(writerDir, { recursive: true, force: true });
  fs.rmSync(readerDir, { recursive: true, force: true });

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
