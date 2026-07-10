// Local no-network test of the harvest pipeline (PLAN-002 v2, C3).
//
// Proves, without DHT/internet:
//   1. wire.mjs preamble: key announce + remainder unshift over a real socket
//      (loopback TCP, coalesced writes included).
//   2. Contributor feed → seed replica replication.
//   3. harvestFeeds(): CaseChunk filter + gate re-check + dedup → records.
//
// Usage:  node tools/seed-peer/test-replication.mjs

import Hypercore from 'hypercore';
import b4a from 'b4a';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readKeyPreamble, writeKeyPreamble } from './wire.mjs';
import { harvestFeeds } from './harvest.mjs';
import { caseId } from './contribute-sim.mjs';

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obdient-seed-test-'));

function makeCase(overrides = {}) {
  const brief = { dtcs: [{ code: 'P0420' }], engineState: 'running', ...overrides.brief };
  const seniorAnswer = overrides.seniorAnswer ?? 'Catalyst efficiency below threshold; check downstream O2.';
  const briefJson = JSON.stringify(brief);
  return {
    type: 'case',
    id: overrides.id ?? caseId(briefJson, seniorAnswer),
    brief,
    seniorAnswer,
    gate: overrides.gate ?? { passed: true, violations: [] },
    outcome: overrides.outcome ?? null,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  // ── 1. Contributor feed with: 1 good case, its duplicate, 1 gate-failed,
  //       1 foreign chunk type, 1 malformed block ─────────────────────────────
  const contributor = new Hypercore(path.join(tmp, 'contributor'));
  await contributor.ready();

  const good = makeCase({});
  const dup = { ...good }; // same content-addressed id
  const rejected = makeCase({
    seniorAnswer: 'Replace the transmission.',
    gate: { passed: false, violations: [{ rule: 'G1', weight: 'hard', detail: 'incoherent domain' }] },
  });
  const foreign = { type: 'fact', id: 'f1', content: 'not a case', confidence: 0.5, confirmations: 1, createdAt: '' };

  for (const c of [good, dup, rejected, foreign]) {
    await contributor.append(b4a.from(JSON.stringify(c), 'utf8'));
  }
  await contributor.append(b4a.from('not-json{{{', 'utf8'));
  check('contributor feed has 5 blocks', contributor.length === 5);

  // ── 2. Wire preamble over real TCP (loopback), coalesced with replication ──
  const seedReplicaDir = path.join(tmp, 'feeds', b4a.toString(contributor.key, 'hex'));

  await new Promise((resolve, reject) => {
    const server = net.createServer(async (socket) => {
      try {
        const key = await readKeyPreamble(socket);
        check('seed received the 32-byte feed key', b4a.equals(key, contributor.key));

        const replica = new Hypercore(seedReplicaDir, key);
        await replica.ready();
        // Raw TCP (not a Noise secret stream): use the explicit protocol-stream
        // pipe form. The unshifted remainder is delivered first by the pipe.
        const rep = replica.replicate(false);
        socket.pipe(rep).pipe(socket);

        // Wait until every block arrived, then close everything.
        await new Promise((res) => {
          const done = () => {
            if (replica.length >= 5) res();
          };
          replica.on('append', done);
          replica.update({ wait: true }).then(done).catch(() => {});
          done();
        });
        await replica.download({ start: 0, end: 5 }).done();
        check('replica received all 5 blocks', replica.length === 5);
        await replica.close();
        socket.destroy();
        server.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const socket = net.connect(port, '127.0.0.1', () => {
        // Preamble + replication on the same socket — coalescing exercised.
        writeKeyPreamble(socket, contributor.key);
        const rep = contributor.replicate(true);
        rep.pipe(socket).pipe(rep);
      });
      socket.on('error', reject);
    });
  });

  // ── 3. Harvest the seed-side replica ────────────────────────────────────────
  const { records, stats } = await harvestFeeds([seedReplicaDir]);

  check('harvest saw 3 case chunks', stats.cases === 3);
  check('gate-failed case rejected', stats.gateRejected === 1);
  check('duplicate deduped by content id', stats.duplicates === 1);
  check('malformed block skipped', stats.malformed === 1);
  check('exactly 1 record exported', records.length === 1);
  check('record carries the senior answer', records[0]?.senior_answer.includes('Catalyst'));
  check('record id is the content hash', records[0]?.case_id === good.id);

  await contributor.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
