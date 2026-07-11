# OBDient — Intelligence Architecture

This document is the deep dive behind the "How it works" summary in the
[README](../README.md). It covers the intake → junior → senior diagnostic pipeline,
the 4-layer knowledge-retrieval pipeline, the deterministic gate + knowledge-return
learning loop, and the end-to-end data flow.

> **TL;DR** — The primary diagnostic path runs **100% on-device** (CARpsy via the
> QVAC SDK). The cloud (Claude) is an opt-in senior advisor the owner summons for a
> single well-fed call — no automatic per-message routing. Knowledge accumulates
> locally over time, so the on-device model effectively gets smarter **without
> retraining its weights**.

---

## The diagnostic pipeline — intake · junior · senior

The chat is a deterministic **state machine** (`DiagnosticIntakeSessionUseCase`),
not a message-by-message router to the cloud. It walks a case through three phases,
and Claude is reached **only** when the owner explicitly asks for a senior review.

```
User message
      │
      ▼
 DiagnosticIntakeSession  ← deterministic state machine, no ML to route
      │
 Phase 1 — Intake (0 tokens, 0 latency)
      │   A template ladder collects the case: vehicle identity (make/model/
      │   year/mileage), symptoms, senses probe, conditions. Nothing hits a model.
      │
      ▼ brief ready
 Phase 2 — Local diagnosis (on-device, offline)
      │   CARpsy (Qwen3-0.6B Q4_K_M) issues a PRELIMINARY diagnosis from the
      │   deterministic brief + 4-layer retrieval. No cloud call. The case then
      │   waits in 'awaiting_senior' — the owner can keep chatting locally.
      │
      ▼ owner taps "senior review"  ← explicit opt-in, the ONLY path that spends tokens
 Phase 3 — Senior advisor (cloud, opt-in)
          ONE well-fed Claude (Sonnet) call carries the redacted brief + the
          junior hypothesis; the senior conducts the diagnosis from there.
          Receives: vehicle facts + symptoms.  Never: VIN, plate, or email.
```

A message that isn't diagnostic — vehicle facts complete but no evidence to work
from — degrades to plain **local** CARpsy chat (`local_only`). Claude is never
auto-invoked for it.

**Why a deterministic state machine and not a router-to-cloud?** A token-budget
revision (ADR-0009) removed the earlier "general questions → Claude" auto-routing
and the per-turn background quality audit: both spent cloud tokens invisibly — on
greetings and on audits the user never saw. Now the private path is the default and
the cloud is one deliberate, well-fed call the owner opts into.

---

## 4-layer knowledge-retrieval pipeline

Every response is grounded by merging up to four knowledge sources. Each layer
degrades gracefully: any failure returns `[]` and the assistant still answers from
live OBD data.

```
Query
  │
  ├─ Layer 0: Claude-learned knowledge (MMKV, keyword match)
  │           Answers Claude already gave in past sessions
  │
  ├─ Layer 1: SHIMI hierarchical tree (SKOS ontology, confidence-ranked)
  │           DTC → canonical concept → ancestors + related nodes
  │
  ├─ Layer 2: QVAC RAG vector search (EmbeddingGemma 300M, on-device)
  │           Semantic similarity over the OBD-II knowledge corpus
  │
  └─ Layer 3: Hypercore pattern evaluator
              Rule-based patterns validated by P2P peer consensus
```

Results are merged, deduplicated, and capped (snippets ≤ 300 chars each) to stay
within CARpsy's context window.

### SHIMI — confidence-weighted knowledge tree

SHIMI (*Semantic Hierarchical Index with Memory Integration*) is an on-device
knowledge graph built from the OBD-II SKOS ontology. Each node tracks a confidence
score updated by human 👍/👎 feedback and peer confirmations.

```
P0300 (Random Misfire)
  └─ misfire_random  [confidence: 0.87]
       ├─ ignition   [confidence: 0.91]
       ├─ fuel_system [confidence: 0.74]
       └─ powertrain  [confidence: 0.95]
```

When a DTC is active, SHIMI returns the highest-confidence content from the **entire
subtree** — not just the exact code match. A P0301 query therefore also retrieves
ignition-system and fuel-system knowledge.

Key files: `src/data/knowledge/shimi-tree.ts`, `src/data/knowledge/obd-ontology.ts`

### Retrieval query construction

For chat (not just auto-interpretation), the query is enriched before retrieval:

```
Usuario: "mi motor tiembla"
                │
                ▼
    ┌─ buildRetrievalQuery() ────────────────┐
    │  Active DTCs + parameters with alerts   │
    │  → "P0300 misfire; RPM warning"         │
    └─────────────────────────────────────────┘
                │
                ▼
    ┌─ retrievalContext(primaryDtcId) ───────┐
    │  SKOS: DTC → canonical concept          │
    │  + ancestors + related nodes            │
    │  P0300 → misfire_random → ignition      │
    │        → powertrain → emissions         │
    │        → fuel_system (related)          │
    └─────────────────────────────────────────┘
                │
                ▼
         expandedQuery =
         userMessage + diagnosticQuery + ontologyExpansion
                │
                ▼
   Layers 1–3 run on the enriched query
                │
                ▼
   "Relevant diagnostic knowledge:
    [1] DTC P0300 — Random misfire...
    [2] Ignition system — spark plugs...
    [3] Pattern (0.85): RPM instability..."
                │
                ▼
         qvacSDK.chat() → response
```

---

## The learning loop — deterministic gate + knowledge return

There is no background cloud scoring (that per-turn quality audit was removed with
the token-budget revision). Answers earn authority through a **deterministic gate**
and **human/outcome verification**, not a second model.

```
Junior (Phase 2) or senior (Phase 3) issues a diagnosis
            ↓
  runGate() validates it against the vehicle's real data (diagnostic-gate.ts)
            │   filter, NOT retry:
    passed ─┼─► the answer ships normally; the verdict persists with the turn
    failed ─┴─► the answer ships marked UNCONFIRMED in the UI

  A gate-PASSED senior diagnosis takes two paths (both opt-in / fire-and-forget):
    (a) stored on-device → SHIMI Layer 0 (MMKV + vector), as UNVERIFIED provenance,
        so the junior retrieves it OFFLINE next time
    (b) contributed as a redacted CaseChunk to the harvest outbox → distillation set
            ↓
  Human 👍/👎 on the diagnosis moves confidence:
    👍 promotes the SHIMI node / confirms the stored answer (→ verified)
    👎 lowers the node / removes the rejected entry
```

Verified knowledge is kept **separate** from unverified in the prompt, so a
single-source Claude suggestion never masquerades as ground truth until a human — or
the car's own outcome — confirms it. Over sessions the on-device model retrieves more
validated knowledge, effectively getting smarter **without retraining its weights**.

---

## End-to-end data flow

```
ELM327 (BT) → OBDRepositoryImpl → obdStore
                                        ↓
                              useChatVM  (sessionId per case)
                                        ↓
                              DiagnosticIntakeSessionUseCase
                              │
                              ├── Phase 1 — intake ladder (deterministic, 0 tokens)
                              │     brief-assembler → DiagnosticBrief (redacted)
                              │
                              ├── Phase 2 — junior local diagnosis
                              │     └── ChatWithQVACUseCase → LLMRepositoryImpl
                              │           ├── ShimiDataSource.searchWithProvenance()
                              │           │   ├── Layer 0: claudeKnowledge (verified/unverified)
                              │           │   ├── Layer 1: shimiTree (SKOS)
                              │           │   ├── Layer 2: qvacRag (embeddings)
                              │           │   └── Layer 3: evaluatePatterns()
                              │           └── qvacSDK.chat()  ← on-device LLM
                              │     └── runGate() → verdict persists with the turn
                              │
                              └── Phase 3 — requestSenior()  [explicit opt-in only]
                                    └── ClaudeAPIDataSource.converseSenior()  (Sonnet)
                                          gate-PASSED answer →
                                          ├── claudeKnowledge.store()  → SHIMI Layer 0 (offline reuse)
                                          └── harvestOutbox.contributeCase()  → CaseChunk (opt-in)
```

---

## On-device RAG (QVAC)

Before each response, OBDient retrieves relevant repair knowledge from a local
vector store and feeds it as grounding context — no internet required.

- **Embedding model:** EmbeddingGemma 300M (4-bit), loaded from Settings alongside
  CARpsy.
- **Knowledge corpus:** curated OBD-II DTC knowledge in
  `src/data/knowledge/obd-knowledge.ts`, ingested once into a persistent QVAC
  workspace.
- **Retrieval:** `src/data/datasources/shimi.datasource.ts` merges all 4 layers,
  deduplicates, and caps snippets at 300 chars each.
- **Graceful degradation:** any layer failure returns `[]`; the assistant still
  answers from live OBD data.

---

## Distributed RAG (Hypercore) — fedRAG

OBDient extends local RAG with a **federated knowledge layer** built on
[Hypercore + Hyperswarm](https://holepunch.to). Each device maintains a local
append-only feed of anonymous diagnostic chunks; instances discover each other via a
shared DHT topic (`obdient-rag-v1`) and replicate feeds without a central server.

**Privacy contract:**
- Chunks never include VIN, Bluetooth address, or any user identifier.
- Only DTC code, make, approximate year range, anonymized assessment text, and a
  confidence score are shared.
- Joining the network and contributing knowledge are **separate opt-in toggles**
  (both off by default).
- Remote chunks must reach `confirmations ≥ 3` (quorum) before surfacing in context,
  and are weighted by peer reputation via the trust registry.

> **Status — full transparency.** The federated layer is **written and compiles but
> has never been exercised peer-to-peer**: during the hackathon OBDient was only ever
> installed on a single device, so cross-device replication was never tested. The
> runtime is also currently **stubbed** because Hermes (React Native's JS engine) has
> no Node.js host to run Hypercore. Treat fedRAG as **architected base code, not a
> demonstrated feature.** The SHIMI tree, SKOS, trust registry, pattern evaluator,
> and local RAG all run fully today.

---

## Roadmap — toward a self-sufficient CARpsy

The long-term goal is for the on-device model to handle the diagnostic domain on its
own, so the cloud agent becomes rarely needed. The strategy separates **knowledge**
(what CARpsy knows — grows with use) from **reasoning** (the fixed 0.6B weights —
only fine-tuning moves them). The cloud reduces calls; fine-tuning raises the floor;
**independent verification** (a human, and the car's own physical outcome) keeps
unverified content from gaining false authority.

| Step | What | Status |
|------|------|--------|
| 1 | Separate *verified* (curated) from *unverified* (Claude) knowledge in the prompt | ✅ Done |
| 2 | Human feedback 👍/👎 that moves SHIMI/Claude confidence | ✅ Done |
| 3 | Semantic retrieval of Claude-learned answers (RAG workspace) | ✅ Done |
| 4 | Ground-truth outcome — did the repair work? (passive DTC-recurrence detection) | 🔲 Planned |
| 5 | Confidence-gated promotion — only verified knowledge becomes "trusted" | 🔲 Planned |
| 6 | Dependency metric — % of queries still escalating to Claude | 🔲 Planned |
| 7 | Fine-tuning loop — distill verified Q→A pairs into CARpsy's weights | 🔲 Planned |

The virtuous cycle: **Claude teaches → human/car verifies → SHIMI accumulates →
CARpsy is retrained → Claude is needed less → repeat.**

📄 Full detail, rationale, and the three "asymptotes" in
**[ROADMAP.md](ROADMAP.md)**.
