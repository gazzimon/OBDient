// Device simulator (PLAN-002 v2, C3 — reference implementation for the C0/C1
// Bare worklet). Creates a local writer feed, appends a sample CaseChunk, joins
// the harvest topic as CLIENT, announces its key (wire preamble) and replicates
// as initiator. Run against a live seed to test end-to-end over the real DHT:
//
//   terminal 1:  node tools/seed-peer/index.mjs
//   terminal 2:  node tools/seed-peer/contribute-sim.mjs
//   then:        node tools/seed-peer/harvest.mjs
//
// Usage:  node tools/seed-peer/contribute-sim.mjs [--data <dir>]

import Hypercore from 'hypercore';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harvestTopic, writeKeyPreamble } from './wire.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? path.resolve(process.argv[idx + 1]) : fallback;
}

/** Content-addressed id — same recipe the device will use. */
export function caseId(briefJson, seniorAnswer) {
  return createHash('sha256').update(briefJson).update(seniorAnswer).digest('hex');
}

function sampleCase() {
  const brief = {
    vehicle: { make: 'Chevrolet', model: 'Tracker', year: 2014 },
    dtcs: [{ code: 'P0420', severity: 'warning' }],
    symptoms: ['loss_of_power'],
    engineState: 'running',
  };
  const briefJson = JSON.stringify(brief);
  const seniorAnswer =
    'P0420 with high mileage and no misfires points to catalyst efficiency decay. ' +
    'Check the downstream O2 sensor response first; if it mirrors upstream, the ' +
    'converter is degraded.';
  return {
    type: 'case',
    id: caseId(briefJson, seniorAnswer),
    brief,
    seniorAnswer,
    gate: { passed: true, violations: [] },
    outcome: null,
    appVersion: 'sim',
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  const dataDir = argValue('--data', path.join(HERE, 'sim-device'));

  const feed = new Hypercore(dataDir);
  await feed.ready();
  console.log(`[sim] local feed: ${b4a.toString(feed.key, 'hex').slice(0, 16)}… (${feed.length} blocks)`);

  const chunk = sampleCase();
  await feed.append(b4a.from(JSON.stringify(chunk), 'utf8'));
  console.log(`[sim] appended case ${chunk.id.slice(0, 12)}… (feed now ${feed.length} blocks)`);

  const swarm = new Hyperswarm();
  swarm.on('connection', (socket) => {
    console.log('[sim] seed connected — announcing key + replicating');
    writeKeyPreamble(socket, feed.key);
    feed.replicate(socket);
    socket.on('error', () => {});
  });

  swarm.join(harvestTopic(), { server: false, client: true });
  await swarm.flush();
  console.log('[sim] flushed to DHT. Leave running until the seed logs the blocks; Ctrl-C to stop.');

  process.on('SIGINT', async () => {
    await swarm.destroy();
    await feed.close();
    process.exit(0);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[sim] fatal:', err);
    process.exit(1);
  });
}
