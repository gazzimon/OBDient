# OBDient harvest seed peer (PLAN-002 v2 · C3/C4)

Plain-Node seed that collects **anonymized, gate-passed diagnostic case pairs**
from opted-in OBDient devices over Hypercore/Hyperswarm — no server framework,
no runtime dependency for the app. If the seed is down, devices keep appending
locally (the feed *is* the outbox) and sync when it reappears.

## Privacy contract (ADR-0002/0003)

Feeds carry `CaseChunk`s only: redacted brief (no VIN by construction),
gate-checked senior answer, optional UX4 outcome. Never: VIN, Bluetooth
address, user identity, raw conversations. Contribution is opt-in on-device;
the seed **re-checks the gate verdict** on harvest (defense in depth).

## Wire protocol — OBDIENT-HARVEST/1

```
[32 bytes]  contributor's Hypercore public key   (fixed-size preamble)
[rest…]     standard Hypercore replication stream
```

DHT topic: `obdient-harvest-v1` (padded to 32 bytes) — separate from the
knowledge topic `obdient-rag-v1`: peers never see each other's cases; knowledge
flows *down* via the curated signed bundle (ADR-0002), cases flow *up* only to
the seed. Contributors join as **client**, the seed joins as **server**.

## Run

```bash
node tools/seed-peer/index.mjs [--data <dir>]    # the seed daemon (PC/VPS)
node tools/seed-peer/harvest.mjs [--out <file>]  # feeds → out/corrections.jsonl
```

End-to-end demo over the real DHT (two terminals + harvest):

```bash
node tools/seed-peer/index.mjs
node tools/seed-peer/contribute-sim.mjs   # simulates a device (also the C0/C1 worklet reference)
node tools/seed-peer/harvest.mjs
```

No-network self-test (feed → replication → harvest, loopback TCP):

```bash
node tools/seed-peer/test-replication.mjs
```

## Files

- `wire.mjs` — topic + key-preamble protocol (the pause/unshift dance matters:
  see comments).
- `index.mjs` — seed daemon; persists feeds under `data/feeds/<key>` and a
  `data/keys.json` registry so harvest works offline and replication resumes.
- `harvest.mjs` — offline export: filter `type:'case'` → re-check `gate.passed`
  → dedup by content-addressed id → `corrections.jsonl` (ADR-0002 Phase 1).
- `contribute-sim.mjs` — desktop device simulator; reference implementation for
  the Bare worklet (C0/C1).
- `test-replication.mjs` — self-test, no DHT/internet needed.

## Output format (`corrections.jsonl`)

```jsonl
{ "case_id": "<sha256(brief+answer)>", "brief": {...}, "senior_answer": "...",
  "gate": {"passed": true, "violations": []}, "outcome": "yes"|null,
  "app": "0.9.x"|null, "observed_at": "<ISO-8601>" }
```

This file is the distillation input (PLAN-002 v2 N5 / ADR-0002 Phase 4).
