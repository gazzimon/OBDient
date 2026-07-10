// Offline harvest: replicated feeds → corrections.jsonl (PLAN-002 v2, C3;
// ADR-0002 Phase 1 format).
//
// Reads every contributor feed registered in data/keys.json, filters
// CaseChunks, RE-CHECKS the gate verdict (defense in depth — the device
// already filters, but the seed never trusts the edge blindly), dedupes by
// content-addressed id, and appends the result to out/corrections.jsonl.
//
// Usage:  node tools/seed-peer/harvest.mjs [--data <dir>] [--out <file>]

import Hypercore from 'hypercore';
import b4a from 'b4a';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? path.resolve(process.argv[idx + 1]) : fallback;
}

/** Pure-ish core: read the given feed dirs and produce deduped, gate-passed
 *  case records. Exported so the local replication test can reuse it. */
export async function harvestFeeds(feedDirs) {
  const seen = new Set();
  const records = [];
  const stats = { blocks: 0, cases: 0, gateRejected: 0, duplicates: 0, malformed: 0 };

  for (const dir of feedDirs) {
    const core = new Hypercore(dir);
    await core.ready();

    for (let i = 0; i < core.length; i++) {
      stats.blocks++;
      let chunk;
      try {
        const buf = await core.get(i, { wait: false });
        if (!buf) continue; // block not locally available (sparse replica)
        chunk = JSON.parse(b4a.toString(buf, 'utf8'));
      } catch {
        stats.malformed++;
        continue;
      }
      if (chunk?.type !== 'case' || typeof chunk.id !== 'string') continue;
      stats.cases++;

      // Defense in depth: only gate-passed cases enter the dataset.
      if (chunk.gate?.passed !== true) {
        stats.gateRejected++;
        continue;
      }
      if (seen.has(chunk.id)) {
        stats.duplicates++;
        continue;
      }
      seen.add(chunk.id);
      records.push({
        case_id: chunk.id,
        brief: chunk.brief,
        senior_answer: chunk.seniorAnswer,
        gate: chunk.gate,
        outcome: chunk.outcome ?? null,
        app: chunk.appVersion ?? null,
        observed_at: chunk.createdAt,
      });
    }
    await core.close();
  }

  return { records, stats };
}

async function main() {
  const dataDir = argValue('--data', path.join(HERE, 'data'));
  const outFile = argValue('--out', path.join(HERE, 'out', 'corrections.jsonl'));

  let keys = {};
  try {
    keys = JSON.parse(fs.readFileSync(path.join(dataDir, 'keys.json'), 'utf8'));
  } catch {
    console.error(`[harvest] no keys.json under ${dataDir} — run the seed first.`);
    process.exit(1);
  }

  const feedDirs = Object.keys(keys).map((k) => path.join(dataDir, 'feeds', k));
  const { records, stats } = await harvestFeeds(feedDirs);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));

  console.log(`[harvest] feeds: ${feedDirs.length} · blocks: ${stats.blocks} · case chunks: ${stats.cases}`);
  console.log(`[harvest] gate-rejected: ${stats.gateRejected} · duplicates: ${stats.duplicates} · malformed: ${stats.malformed}`);
  console.log(`[harvest] → ${records.length} records written to ${outFile}`);
}

// Run as CLI only when invoked directly (the test imports harvestFeeds).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[harvest] fatal:', err);
    process.exit(1);
  });
}
