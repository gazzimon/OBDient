// Knowledge peer — reference/verification peer for the OBDient distributed-RAG
// feed (PLAN-002 v2 C2). The seed does NOT serve the knowledge topic
// (obdient-rag-v1 is device↔device), so this stands in for a second device on
// the PC: it lets you verify, without a second phone, that
//   1. the app REPLICATES its knowledge feed out (we log the device's chunks), and
//   2. the app INGESTS ours continuously (ADR-0010 F1) — press Enter to append a
//      new fact over an already-open connection and watch it land on the device.
//
// Mirrors obdient-seed/test/sim-client.mjs, but for the symmetric OBDIENT-RAG/1
// handshake (both sides announce their key + read the other's), and with the
// FactChunk schema of src/data/knowledge/distributed-chunk.ts.
//
// Usage:  node scripts/knowledge-peer.mjs [--data <dir>]
//   terminal 1:  run the app on device with "Distributed RAG" ON
//   terminal 2:  node scripts/knowledge-peer.mjs
//   then:        press Enter to push another fact (tests live ingest)

import Hypercore from 'hypercore';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';

// MUST match src/data/knowledge/distributed-chunk.ts and the worklet.
const RAG_TOPIC = b4a.from('obdient-rag-v1'.padEnd(32, '\0').slice(0, 32), 'utf8');
const KEY_BYTES = 32;
const QUORUM_FACT = 3; // MIN_CONFIRMATIONS — a fact must meet this to surface in getChunks

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? path.resolve(process.argv[idx + 1]) : fallback;
}

let counter = 0;
function sampleFact() {
  counter += 1;
  return {
    type: 'fact',
    id: `peer-fact-${String(counter).padStart(3, '0')}`,
    dtc: 'P0301',
    make: 'VW',
    yearRange: [2012, 2018],
    // confirmations >= QUORUM so the device surfaces it in getChunks immediately.
    content: `Cylinder 1 misfire (P0301): coil pack #${counter} is the usual culprit on EA211 — swap-test before the injector.`,
    confidence: 0.8,
    confirmations: QUORUM_FACT,
    createdAt: new Date().toISOString(),
  };
}

// OBDIENT-RAG/1: read exactly 32 bytes (peer's feed key), unshift the remainder
// so Hypercore's replication protocol sees an untouched stream.
function readKeyPreamble(socket, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const timer = setTimeout(() => { cleanup(); reject(new Error('no key preamble')); }, timeout);
    const onError = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error('closed before preamble')); };
    const onData = (data) => {
      chunks.push(data);
      total += data.length;
      if (total < KEY_BYTES) return;
      socket.pause();
      cleanup();
      const all = b4a.concat(chunks);
      const key = all.subarray(0, KEY_BYTES);
      const rest = all.subarray(KEY_BYTES);
      if (rest.length > 0) socket.unshift(rest);
      resolve(key);
    };
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function ingestRemote(remote, peerId) {
  let cursor = 0, pumping = false, again = false;
  const pump = async () => {
    if (pumping) { again = true; return; }
    pumping = true;
    do {
      again = false;
      const len = remote.length;
      for (; cursor < len; cursor++) {
        try {
          const buf = await remote.get(cursor, { wait: true });
          const chunk = JSON.parse(b4a.toString(buf, 'utf8'));
          console.log(`[peer] ⇐ device chunk: ${chunk.type} ${chunk.id} — ${String(chunk.content ?? chunk.conclusion ?? '').slice(0, 60)}`);
        } catch { /* skip */ }
      }
    } while (again);
    pumping = false;
  };
  remote.on('append', pump);
  await remote.update({ wait: true }).catch(() => {});
  await pump();
}

async function main() {
  const dataDir = argValue('--data', path.join(os.tmpdir(), 'obdient-knowledge-peer'));

  const feed = new Hypercore(dataDir);
  await feed.ready();
  console.log(`[peer] local feed: ${b4a.toString(feed.key, 'hex').slice(0, 16)}… (${feed.length} blocks)`);

  const first = sampleFact();
  await feed.append(b4a.from(JSON.stringify(first), 'utf8'));
  console.log(`[peer] ⇒ appended ${first.id} (feed now ${feed.length} blocks)`);

  const swarm = new Hyperswarm();
  const seen = new Set();
  swarm.on('connection', (socket) => {
    socket.on('error', () => {});
    // Symmetric handshake: announce our key, read theirs, replicate both ways.
    socket.write(feed.key);
    readKeyPreamble(socket)
      .then((remoteKey) => {
        const peerId = b4a.toString(remoteKey, 'hex').slice(0, 16);
        console.log(`[peer] ✓ connected to device ${peerId}`);
        feed.replicate(socket);
        if (!seen.has(peerId)) {
          seen.add(peerId);
          const remote = new Hypercore(path.join(dataDir + '-remotes', peerId), remoteKey);
          remote.ready().then(() => {
            remote.replicate(socket);
            void ingestRemote(remote, peerId);
          });
        }
      })
      .catch((err) => { console.warn('[peer] handshake failed:', err.message); socket.destroy(); });
  });

  swarm.join(RAG_TOPIC, { server: true, client: true });
  await swarm.flush();
  console.log('[peer] flushed to DHT. Press Enter to push another fact (tests F1 live ingest); Ctrl-C to stop.');

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async () => {
    const next = sampleFact();
    await feed.append(b4a.from(JSON.stringify(next), 'utf8'));
    console.log(`[peer] ⇒ appended ${next.id} LIVE (feed now ${feed.length} blocks) — watch the device ingest it`);
  });

  process.on('SIGINT', async () => {
    await swarm.destroy();
    await feed.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[peer] fatal:', err);
  process.exit(1);
});
