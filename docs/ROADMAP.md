# Roadmap — Toward a self-sufficient CARpsy

**Goal:** make CARpsy (the on-device model) handle the diagnostic domain on its own,
so the cloud agent (Claude) becomes rarely needed — and eventually unnecessary for
routine diagnostics.

This document explains the strategy, what already ships, and the steps left.

> **Execution status:** for the ordered, dependency-aware view of open work as of
> 2026-07-10 (what's merged, what's next), see [ROADMAP-2026-07.md](ROADMAP-2026-07.md).
> This file stays the *why* (the learning-loop strategy); that one is the *what next*.

---

## The core insight: knowledge ≠ reasoning

"CARpsy without Claude" has two meanings, and only one is solved by accumulating data:

| | Solved by accumulating knowledge? |
|---|---|
| **Knowledge** (what it knows) | ✅ Yes — SHIMI/RAG grow; the bounded DTC domain saturates |
| **Reasoning** (how it synthesizes) | ❌ No — the 0.6B weights are **fixed**; they don't improve with use |

So accumulating knowledge makes Claude get **called less**, but it doesn't raise
CARpsy's reasoning ceiling. To truly stop needing Claude, the validated knowledge must
eventually be **distilled into CARpsy's weights (fine-tuning)** — not just stored in a
sidecar index.

- The knowledge store **reduces** Claude calls.
- Fine-tuning **raises the floor**.
- You need both.

## Three asymptotes

1. **Knowledge coverage** (SHIMI grows) → *saturates* for the bounded diagnostic domain.
2. **Retrieval quality** (how that knowledge is found) → was the bottleneck; fixed in Step 3 (semantic).
3. **Reasoning capacity** (the 0.6B model) → the hard floor; only fine-tuning moves it.

## Trust principle

Unverified single-source content (Claude) must never gain authority through a closed
loop where Claude validates Claude. **Independent verification** — a human, and the
car's own physical outcome — is what breaks that loop and lets confidence rise safely.

---

## Status

| Step | What | Status |
|------|------|--------|
| 1 | Cut the single-source leak — separate *verified* (curated) from *unverified* (Claude) in the prompt | ✅ Done |
| 2 | HITL Level A — 👍/👎 feedback that moves SHIMI/Claude confidence | ✅ Done |
| 3 | Semantic retrieval — ingest Claude answers into a RAG workspace so they're found by meaning | ✅ Done |
| 4 | Ground-truth outcome — did the repair actually work? | 🔲 Planned |
| 5 | Confidence-gated promotion — only verified knowledge becomes "trusted" | 🔲 Planned |
| 6 | Dependency metric — measure what % of queries still escalate to Claude | 🔲 Planned |
| 7 | Fine-tuning loop — distill verified Q→A pairs into CARpsy's weights | 🔲 Planned |

---

## Step 4 — Ground-truth outcome ("did the fix work?")

The strongest possible signal in this domain is physical: the repair either fixed the
fault or it didn't. Two ways to capture it, in priority order:

**4a — Passive outcome detection (primary, objective, zero-friction).**
OBDient already reconnects to the car and persists sessions in SQLite. Compare a
session's DTCs against future sessions for the same vehicle:
- A diagnosed DTC that **disappears and stays gone** across several drive cycles → the
  fix worked → raise confidence of the knowledge that diagnosed it.
- A DTC that **recurs** → the fix didn't work → lower confidence.

No human input required. This is the killer signal and it uses data we already store.

**4b — Conversational attribution (secondary, enriches).**
The car sees the DTC clear, but not *what* cleared it ("I changed the spark plugs"
vs "the shop replaced the MAF"). A short follow-up captures that attribution, which
the OBD data can't. Optional; also the basis for a B2B workshop follow-up surface.

## Step 5 — Confidence-gated promotion

Knowledge starts **unverified** (low confidence). It only crosses the threshold to
**trusted** — and receives authoritative treatment in the prompt — after independent
confirmation (human 👍 and/or passive outcome). This is the local equivalent of the
Hypercore peer-consensus model (`confirmations ≥ 3`), with the human/car as the source.

## Step 6 — Dependency metric

Instrument what fraction of queries still escalate to Claude, split by type
(diagnostic vs general; novel vs repeated). Without the metric we can't tell whether
the system is actually becoming independent.

## Step 7 — Fine-tuning loop (closes the circle)

The human/outcome-**verified** question→answer pairs are a clean training dataset.
Periodically retrain CARpsy on them → the reasoning floor rises → the next version
needs Claude even less. Claude's role shifts from "co-pilot on every general question"
to **data factory for the next CARpsy** + rare novel-case handler.

```
Claude teaches → human/car verifies → SHIMI accumulates → CARpsy is retrained
      → Claude is needed less → repeat
```

---

## Honest end state

```
Diagnostic queries (bounded domain) → CARpsy alone.        ✅ achievable
Repeated general questions           → CARpsy (cached).     ✅ achievable
Genuinely new general questions      → always a first time.  ❌ asymptote
Periodic quality auditor             → worth keeping.
```

Claude never reaches zero, but settles at a **low floor**: genuinely novel cases plus
generating the fine-tuning dataset. Independence for the routine diagnostic domain is
achievable; full independence for open-ended general questions is asymptotic.
