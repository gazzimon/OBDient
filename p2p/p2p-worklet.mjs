// P2P worklet — the single Bare runtime that owns BOTH device P2P feeds
// (grew out of the C0 spike, whose probe commands it keeps).
//
// Runs on Bare (react-native-bare-kit) — never Hermes: hypercore/hyperswarm
// resolve for real here (Metro used to stub them on the RN side; C2 retired the
// stub). C0 validated the full substrate on-device (sodium/storage/udx addons).
//
// IPC is multiplexed by a `ns` field so one worklet serves two datasources:
//   - ns:'harvest'   → obdient-harvest-v1, CLIENT only. The append-only case
//                      outbox (PLAN-002 v2 C1). The feed IS the outbox.
//   - ns:'knowledge' → obdient-rag-v1, SERVER+CLIENT. The distributed RAG feed
//                      (C2). Bidirectional: we replicate our feed out AND pull
//                      each peer's, ingesting blocks continuously (ADR-0010 F1).
// A message without `ns` defaults to 'harvest' (back-compat with the C0 spike,
// which drives spike-core/spike-swarm directly).
//
// IPC protocol (newline-delimited JSON over BareKit.IPC), replies echo `ns`:
//   ← {ns:'harvest', cmd:'open', dir?, swarm?}        → {step:'open', ok, key, length}
//   ← {ns:'harvest', cmd:'appendCase', brief, ...}    → {step:'append', ok, id, length}
//   ← {ns:'harvest', cmd:'status'}                    → {step:'status', ok, key, length, peers}
//   ← {ns:'knowledge', cmd:'open', swarm?}            → {step:'open', ok, key, length}
//   ← {ns:'knowledge', cmd:'contribute', chunk}       → {step:'append', ok, length}
//   ← {ns:'knowledge', cmd:'status'}                  → {step:'status', ok, key, length, peers}
//   ← {ns:'knowledge', cmd:'close'}                   → {step:'close', ok}
//   → {ns:'knowledge', step:'chunk', ok, chunk, peerId}   (unsolicited: ingest)
//   → {ns:'knowledge', step:'peer', ok, peerId?, peers}   (unsolicited: churn)
//   ← {cmd:'spike-core'|'spike-swarm'}               → {step:'core'|'swarm', ok, ...}

/* global BareKit */

import Hypercore from 'hypercore';
import b4a from 'b4a';
import os from 'bare-os';
import path from 'bare-path';
import fs from 'bare-fs';
import { createHash } from 'bare-crypto';
import { RemoteFeedManager } from './remote-feed-manager.mjs';

const { IPC } = BareKit;

// MUST match obdient-seed/PROTOCOL.md and distributed-chunk.ts.
const HARVEST_TOPIC = b4a.from('obdient-harvest-v1'.padEnd(32, '\0').slice(0, 32), 'utf8');
const RAG_TOPIC = b4a.from('obdient-rag-v1'.padEnd(32, '\0').slice(0, 32), 'utf8');

// Fallback dirs only. The RN side passes the real PERSISTENT path on `open`
// (see worklet-host.persistentFeedDir): bare-os homedir() is `/data` on Android
// — not app-writable → ENOENT. tmpdir() is the app sandbox tmp (writable; the
// C0 spike proved it) so a missing dir degrades to ephemeral, never a crash.
const HARVEST_DIR = path.join(os.tmpdir(), 'obdient-harvest-feed');
const KNOWLEDGE_DIR = path.join(os.tmpdir(), 'obdient-knowledge-feed');
// Ephemeral read-only replicas of peers' feeds — flat, one dir per peer under
// the writable sandbox tmp; removed on disconnect.
const KNOWLEDGE_REMOTE_PREFIX = 'obd-kremote-';
const SPIKE_DIR = path.join(os.tmpdir(), 'obdient-harvest-spike');

const KEY_BYTES = 32;
// Cap on concurrently-open remote feeds — bounds RAM / FDs / disk under peer
// churn (ADR-0010 P0). Beyond it, new peers get local replication only.
const MAX_REMOTE_FEEDS = 32;
// Reject remote blocks larger than this before JSON.parse — a hostile peer must
// not be able to force a giant string allocation on ingest (ADR-0010 P1).
const MAX_CHUNK_BYTES = 64 * 1024;
// A peer that connects and sends no key preamble must not hold the socket open.
const PREAMBLE_TIMEOUT_MS = 30_000;

function send(msg) {
  IPC.write(b4a.from(JSON.stringify(msg) + '\n', 'utf8'));
}

/** Content-addressed case id — the exact recipe the hub re-checks. */
function caseId(briefJson, seniorAnswer) {
  return createHash('sha256').update(briefJson).update(seniorAnswer).digest('hex');
}

// OBDIENT-RAG/1 wire handshake (symmetric variant of OBDIENT-HARVEST/1 in
// obdient-seed/src/seed/wire.mjs): read exactly 32 bytes (the peer's feed key)
// off the socket, then unshift any remainder so the replication protocol sees
// an untouched stream. streamx secret streams support pause()/unshift() on Bare.
function readKeyPreamble(socket, timeout = PREAMBLE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const timer = setTimeout(() => { cleanup(); reject(new Error(`no key preamble within ${timeout}ms`)); }, timeout);
    const onError = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error('connection closed before key preamble')); };
    const onData = (data) => {
      chunks.push(data);
      total += data.length;
      if (total < KEY_BYTES) return;
      // Stop the flow BEFORE detaching, or bytes arriving while replication is
      // still being set up (async) are silently dropped in flowing mode.
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

// ─── Harvest outbox (ns:'harvest') ────────────────────────────────────────────

let harvestFeed = null;   // the persistent local writer feed
let harvestSwarm = null;  // hyperswarm client (only when sync enabled)

async function harvestOpen(dir, joinSwarm) {
  if (harvestFeed === null) {
    harvestFeed = new Hypercore(dir || HARVEST_DIR);
    await harvestFeed.ready();
  }
  if (joinSwarm && harvestSwarm === null) {
    const { default: Hyperswarm } = await import('hyperswarm');
    harvestSwarm = new Hyperswarm();
    harvestSwarm.on('connection', (socket) => {
      socket.on('error', () => {}); // seed churn is normal
      // OBDIENT-HARVEST/1: announce our feed key, then replicate as initiator.
      socket.write(harvestFeed.key);
      harvestFeed.replicate(socket);
    });
    harvestSwarm.join(HARVEST_TOPIC, { server: false, client: true });
  }
  return { key: b4a.toString(harvestFeed.key, 'hex'), length: harvestFeed.length };
}

async function appendCase(msg) {
  if (harvestFeed === null) await harvestOpen(null, false);
  if (typeof msg.seniorAnswer !== 'string' || msg.brief == null || typeof msg.brief !== 'object') {
    throw new Error('appendCase requires brief (object) and seniorAnswer (string)');
  }
  const briefJson = JSON.stringify(msg.brief);
  const id = caseId(briefJson, msg.seniorAnswer);
  const chunk = {
    type: 'case',
    v: 1,
    id,
    brief: msg.brief,
    seniorAnswer: msg.seniorAnswer,
    gate: msg.gate ?? { passed: false, violations: [] },
    outcome: msg.outcome ?? null,
    ...(msg.appVersion ? { appVersion: msg.appVersion } : {}),
    createdAt: new Date().toISOString(),
  };
  await harvestFeed.append(b4a.from(JSON.stringify(chunk), 'utf8'));
  return { id, length: harvestFeed.length };
}

function harvestStatusBody() {
  return {
    key: harvestFeed ? b4a.toString(harvestFeed.key, 'hex') : null,
    length: harvestFeed ? harvestFeed.length : 0,
    peers: harvestSwarm ? harvestSwarm.connections.size : 0,
  };
}

// ─── Distributed knowledge (ns:'knowledge') ──────────────────────────────────

let knowledgeFeed = null;   // persistent local writer feed
let knowledgeSwarm = null;  // hyperswarm server+client (only when enabled)

// One feed per peer, reused across reconnects, closed on the last disconnect,
// with a hard cap on concurrency (ADR-0010 P0). Cleanup removes the temp dir.
const knowledgeRemoteFeeds = new RemoteFeedManager(MAX_REMOTE_FEEDS, (p) => {
  fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
});

async function openKnowledge(dir, joinSwarm) {
  if (knowledgeFeed === null) {
    knowledgeFeed = new Hypercore(dir || KNOWLEDGE_DIR);
    await knowledgeFeed.ready();
    await loadLocalKnowledge();
  }
  if (joinSwarm && knowledgeSwarm === null) {
    const { default: Hyperswarm } = await import('hyperswarm');
    knowledgeSwarm = new Hyperswarm();
    knowledgeSwarm.on('connection', (socket) => { void handleKnowledgePeer(socket); });
    knowledgeSwarm.join(RAG_TOPIC, { server: true, client: true });
  }
  return { key: b4a.toString(knowledgeFeed.key, 'hex'), length: knowledgeFeed.length };
}

// Replay our own previously-contributed blocks to the RN mirror on open.
async function loadLocalKnowledge() {
  const length = knowledgeFeed.length;
  for (let i = 0; i < length; i++) {
    try {
      const buf = await knowledgeFeed.get(i);
      if (buf == null || buf.length > MAX_CHUNK_BYTES) continue;
      const chunk = JSON.parse(b4a.toString(buf, 'utf8'));
      send({ ns: 'knowledge', step: 'chunk', ok: true, chunk, peerId: 'local' });
    } catch {
      // Skip malformed blocks.
    }
  }
}

function reportKnowledgePeers(peerId) {
  const peers = knowledgeSwarm ? knowledgeSwarm.connections.size : 0;
  send({ ns: 'knowledge', step: 'peer', ok: true, ...(peerId ? { peerId } : {}), peers });
}

async function handleKnowledgePeer(socket) {
  socket.on('error', () => {}); // peer churn is normal
  let peerId = null;
  try {
    // OBDIENT-RAG/1 symmetric handshake: announce our key, read the peer's.
    socket.write(knowledgeFeed.key);
    const remoteKey = await readKeyPreamble(socket);
    peerId = b4a.toString(remoteKey, 'hex').slice(0, 16);

    reportKnowledgePeers(peerId);

    // Reuse this peer's feed across reconnects; open a NEW read-only replica of
    // the peer's key otherwise (null when the concurrent-feed cap is hit).
    const acquired = knowledgeRemoteFeeds.acquire(peerId, () => {
      const p = path.join(os.tmpdir(), `${KNOWLEDGE_REMOTE_PREFIX}${peerId}`);
      return { feed: new Hypercore(p, remoteKey), path: p };
    });

    // Always let the peer pull OUR feed — even past the remote-feed cap.
    knowledgeFeed.replicate(socket);

    if (acquired == null) {
      socket.on('close', () => reportKnowledgePeers());
      return; // cap hit — outbound replication only, no ingest
    }

    const remoteFeed = acquired.feed;
    socket.on('close', () => {
      void knowledgeRemoteFeeds.release(peerId);
      reportKnowledgePeers();
    });

    if (acquired.isNew) {
      await remoteFeed.ready();
      // ADR-0010 F1 — continuous ingest: pump existing blocks now, and every
      // block that arrives by live replication after the connection is open.
      // Serialized so overlapping 'append' events don't skip a cursor.
      let cursor = 0, pumping = false, again = false;
      const pump = async () => {
        if (pumping) { again = true; return; }
        pumping = true;
        do {
          again = false;
          const len = remoteFeed.length;
          for (; cursor < len; cursor++) {
            try {
              const buf = await remoteFeed.get(cursor, { wait: true });
              if (buf == null || buf.length > MAX_CHUNK_BYTES) continue;
              const chunk = JSON.parse(b4a.toString(buf, 'utf8'));
              send({ ns: 'knowledge', step: 'chunk', ok: true, chunk, peerId });
            } catch {
              // Skip malformed / undownloadable blocks.
            }
          }
        } while (again);
        pumping = false;
      };
      // The append listener lives as long as the FEED does (not this socket):
      // a peer may hold several simultaneous sockets during churn, and the feed
      // stays open — replicating on the others — until the LAST ref drops. We
      // don't off() it on socket close; RemoteFeedManager.release closes the
      // feed on the last disconnect and a closed feed emits no more appends.
      remoteFeed.on('append', pump);
      remoteFeed.replicate(socket);
      await remoteFeed.update({ wait: true }).catch(() => {});
      await pump();
    } else {
      // A live socket already owns the append pump; just replicate on this one.
      remoteFeed.replicate(socket);
    }
  } catch {
    if (peerId != null) void knowledgeRemoteFeeds.release(peerId);
    try { socket.destroy(); } catch {}
  }
}

async function contributeKnowledge(msg) {
  if (knowledgeFeed === null) await openKnowledge(false);
  if (msg.chunk == null || typeof msg.chunk !== 'object') {
    throw new Error('contributeKnowledge requires chunk (object)');
  }
  await knowledgeFeed.append(b4a.from(JSON.stringify(msg.chunk), 'utf8'));
  return { length: knowledgeFeed.length };
}

function knowledgeStatusBody() {
  return {
    key: knowledgeFeed ? b4a.toString(knowledgeFeed.key, 'hex') : null,
    length: knowledgeFeed ? knowledgeFeed.length : 0,
    peers: knowledgeSwarm ? knowledgeSwarm.connections.size : 0,
  };
}

async function closeKnowledge() {
  if (knowledgeSwarm) { await knowledgeSwarm.destroy(); knowledgeSwarm = null; }
  await knowledgeRemoteFeeds.closeAll();
  if (knowledgeFeed) { await knowledgeFeed.close(); knowledgeFeed = null; }
  return {};
}

// ─── C0 probes (kept — Settings "P2P engine test" uses them) ─────────────────

async function spikeCore(dir) {
  const core = new Hypercore(dir || SPIKE_DIR);
  await core.ready();
  await core.append(b4a.from(JSON.stringify({ probe: 'obdient-c0', ts: Date.now() }), 'utf8'));
  const buf = await core.get(core.length - 1);
  const roundtrip = JSON.parse(b4a.toString(buf, 'utf8'));
  const key = b4a.toString(core.key, 'hex');
  await core.close();
  if (roundtrip.probe !== 'obdient-c0') throw new Error('roundtrip mismatch');
  return { key, blocks: 1 };
}

async function spikeSwarm() {
  const { default: Hyperswarm } = await import('hyperswarm');
  const probe = new Hyperswarm();
  await probe.destroy();
  return {};
}

// ─── IPC dispatch ────────────────────────────────────────────────────────────

// Each entry maps a command to its reply `step` and handler. Replies echo `ns`;
// the RN worklet-host keys its waiters by `${ns}:${step}`.
const HANDLERS = {
  harvest: {
    'open':        { step: 'open',   fn: (m) => harvestOpen(m.dir, m.swarm === true) },
    'appendCase':  { step: 'append', fn: (m) => appendCase(m) },
    'status':      { step: 'status', fn: () => Promise.resolve(harvestStatusBody()) },
    'spike-core':  { step: 'core',   fn: (m) => spikeCore(m.dir) },
    'spike-swarm': { step: 'swarm',  fn: () => spikeSwarm() },
  },
  knowledge: {
    'open':       { step: 'open',   fn: (m) => openKnowledge(m.dir, m.swarm === true) },
    'contribute': { step: 'append', fn: (m) => contributeKnowledge(m) },
    'status':     { step: 'status', fn: () => Promise.resolve(knowledgeStatusBody()) },
    'close':      { step: 'close',  fn: () => closeKnowledge() },
  },
};

let buffer = '';
IPC.on('data', (data) => {
  buffer += b4a.toString(data, 'utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    const ns = msg.ns === 'knowledge' ? 'knowledge' : 'harvest';
    const entry = HANDLERS[ns]?.[msg.cmd];
    if (!entry) continue;

    Promise.resolve(entry.fn(msg))
      .then((body) => send({ ns, step: entry.step, ok: true, ...(body || {}) }))
      .catch((err) => send({ ns, step: entry.step, ok: false, err: String(err?.message ?? err) }));
  }
});

send({ step: 'ready', ok: true });
