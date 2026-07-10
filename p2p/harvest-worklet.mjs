// C0 spike worklet (PLAN-002 v2): does Hypercore run inside the Bare worklet
// that already ships with the app (react-native-bare-kit, same runtime the
// QVAC SDK worker uses)?
//
// Metro stubs `hypercore`/`hyperswarm` on Hermes because they need Node
// built-ins — but THIS file never touches Hermes: it is packed by `bare-pack`
// (npm run p2p:pack) and executed by Bare, which provides bare-fs/bare-net/etc.
// The QVAC SDK already depends on hyperdht/udx-native via @qvac/rag, so the
// networking stack is in the dependency tree; whether its native addons load
// inside OUR worklet on Android is precisely what this spike verifies.
//
// IPC protocol (newline-delimited JSON over BareKit.IPC):
//   ← { cmd: 'spike-core',  dir: '<abs storage path>' }
//   → { step: 'core', ok: true, key: '<hex>', blocks: n }        (or ok:false, err)
//   ← { cmd: 'spike-swarm' }
//   → { step: 'swarm', ok: true }                                (or ok:false, err)
//
// Two commands on purpose: hypercore (sodium/storage addons) and hyperswarm
// (udx addon) fail independently — granular spike results.

/* global BareKit */

import Hypercore from 'hypercore';
import b4a from 'b4a';
import os from 'bare-os';
import path from 'bare-path';

const { IPC } = BareKit;

// Storage default: the worklet picks its own dir (no RN-side path plumbing).
// On Android the Bare tmpdir maps inside the app sandbox.
const DEFAULT_DIR = path.join(os.tmpdir(), 'obdient-harvest-spike');

function send(msg) {
  IPC.write(b4a.from(JSON.stringify(msg) + '\n', 'utf8'));
}

async function spikeCore(dir) {
  const core = new Hypercore(dir);
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
  // Constructing Hyperswarm loads udx-native — the addon-risk moment. We do
  // NOT join any topic in the spike; construction + destroy is the probe.
  const { default: Hyperswarm } = await import('hyperswarm');
  const swarm = new Hyperswarm();
  await swarm.destroy();
  return {};
}

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

    if (msg.cmd === 'spike-core') {
      spikeCore(msg.dir || DEFAULT_DIR)
        .then((r) => send({ step: 'core', ok: true, ...r }))
        .catch((err) => send({ step: 'core', ok: false, err: String(err?.message ?? err) }));
    } else if (msg.cmd === 'spike-swarm') {
      spikeSwarm()
        .then(() => send({ step: 'swarm', ok: true }))
        .catch((err) => send({ step: 'swarm', ok: false, err: String(err?.message ?? err) }));
    }
  }
});

send({ step: 'ready', ok: true });
