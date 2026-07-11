// Harvest outbox worklet (PLAN-002 v2 C1; grew out of the C0 spike, whose
// probe commands it keeps).
//
// Runs on Bare (react-native-bare-kit) — never Hermes: hypercore/hyperswarm
// resolve for real here (Metro stubs them on the RN side). C0 validated the
// full substrate on-device (sodium/storage/udx addons all load).
//
// Responsibilities:
//   - Own the device's append-only case feed: the feed IS the outbox.
//     Store-and-forward is Hypercore's: blocks accumulate offline and
//     replicate whenever the seed peer is reachable.
//   - Compute the content-addressed case id. The hash recipe lives HERE
//     (and at the hub, which re-checks it — PROTOCOL.md anti-poisoning):
//     sha256(JSON.stringify(brief) + seniorAnswer), compact stringify.
//   - Sync: join the harvest DHT topic as CLIENT, announce the feed key
//     (32-byte preamble), replicate as initiator. Never a server.
//
// IPC protocol (newline-delimited JSON over BareKit.IPC):
//   ← { cmd: 'open', dir?: string, swarm?: boolean }
//   → { step: 'open', ok, key, length }
//   ← { cmd: 'appendCase', brief, seniorAnswer, gate, outcome?, appVersion? }
//   → { step: 'append', ok, id, length }        (id echoes the computed hash)
//   ← { cmd: 'status' }
//   → { step: 'status', ok, key, length, peers }
//   ← { cmd: 'spike-core' | 'spike-swarm' }     (C0 probes, kept for Settings)
//   → { step: 'core' | 'swarm', ok, ... }

/* global BareKit */

import Hypercore from 'hypercore';
import b4a from 'b4a';
import os from 'bare-os';
import path from 'bare-path';
import { createHash } from 'bare-crypto';

const { IPC } = BareKit;

// MUST match obdient-seed/PROTOCOL.md and distributed-chunk.ts.
const HARVEST_TOPIC = b4a.from('obdient-harvest-v1'.padEnd(32, '\0').slice(0, 32), 'utf8');

const DEFAULT_DIR = path.join(os.homedir(), 'obdient-harvest-feed');
const SPIKE_DIR = path.join(os.tmpdir(), 'obdient-harvest-spike');

function send(msg) {
  IPC.write(b4a.from(JSON.stringify(msg) + '\n', 'utf8'));
}

/** Content-addressed case id — the exact recipe the hub re-checks. */
function caseId(briefJson, seniorAnswer) {
  return createHash('sha256').update(briefJson).update(seniorAnswer).digest('hex');
}

// ─── Outbox state ───────────────────────────────────────────────────────────

let feed = null;   // the persistent local writer feed
let swarm = null;  // hyperswarm client (only when sync enabled)

async function open(dir, joinSwarm) {
  if (feed === null) {
    feed = new Hypercore(dir || DEFAULT_DIR);
    await feed.ready();
  }
  if (joinSwarm && swarm === null) {
    const { default: Hyperswarm } = await import('hyperswarm');
    swarm = new Hyperswarm();
    swarm.on('connection', (socket) => {
      socket.on('error', () => {}); // seed churn is normal
      // OBDIENT-HARVEST/1: announce our feed key, then replicate as initiator.
      socket.write(feed.key);
      feed.replicate(socket);
    });
    swarm.join(HARVEST_TOPIC, { server: false, client: true });
  }
  return { key: b4a.toString(feed.key, 'hex'), length: feed.length };
}

async function appendCase(msg) {
  if (feed === null) await open(null, false);
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
  await feed.append(b4a.from(JSON.stringify(chunk), 'utf8'));
  return { id, length: feed.length };
}

// ─── C0 probes (kept — Settings "P2P engine test" uses them) ───────────────

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

const HANDLERS = {
  'open': (msg) => open(msg.dir, msg.swarm === true).then((r) => ({ step: 'open', ok: true, ...r })),
  'appendCase': (msg) => appendCase(msg).then((r) => ({ step: 'append', ok: true, ...r })),
  'status': () =>
    Promise.resolve({
      step: 'status',
      ok: true,
      key: feed ? b4a.toString(feed.key, 'hex') : null,
      length: feed ? feed.length : 0,
      peers: swarm ? swarm.connections.size : 0,
    }),
  'spike-core': (msg) => spikeCore(msg.dir).then((r) => ({ step: 'core', ok: true, ...r })),
  'spike-swarm': () => spikeSwarm().then(() => ({ step: 'swarm', ok: true })),
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

    const handler = HANDLERS[msg.cmd];
    if (!handler) continue;
    const step = msg.cmd === 'appendCase' ? 'append' : msg.cmd.replace('spike-', '');
    handler(msg)
      .then(send)
      .catch((err) => send({ step, ok: false, err: String(err?.message ?? err) }));
  }
});

send({ step: 'ready', ok: true });
