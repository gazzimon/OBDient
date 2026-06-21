# OBDient — Intelligence Architecture

This document is the deep dive behind the "How it works" summary in the
[README](../README.md). It covers the full multi-agent system, the 4-layer
knowledge-retrieval pipeline, the quality-evaluator loop, and the end-to-end data
flow.

> **TL;DR** — The primary diagnostic path runs **100% on-device** (CARpsy via the
> QVAC SDK). The cloud (Claude) is an opt-in enhancement for general questions and
> background quality evaluation only. Knowledge accumulates locally over time, so
> the on-device model effectively gets smarter **without retraining its weights**.

---

## Two-agent system

A deterministic router (no ML, no added latency) classifies every message and sends
it down the right path.

```
User message
      │
      ▼
 QueryRouter  ← deterministic, no ML
      │
      ├── DTCs / sensor keywords / fault diagnosis
      │       ↓
      │   CARpsy (on-device, Qwen3-0.6B Q4_K_M)
      │   + 4-layer knowledge retrieval
      │   Private · Fast · Works offline
      │
      └── General automotive questions
              ↓
          Claude API (cloud, Haiku)
          Receives: make/model/year + question only
          Never receives: VIN, sensor readings
              ↓
          Answer stored in SHIMI (offline reuse)
```

**Why deterministic routing?** Classification by keyword/DTC presence is instant,
auditable, and free — no model call to decide which model to call. The private path
(diagnostics) never touches the network.

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
score updated by peer confirmations and Claude quality evaluations.

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

## Quality-evaluator loop

After CARpsy answers a diagnostic question, Claude silently scores it in the
background (non-blocking). Low-scoring answers produce a correction that is stored
back into SHIMI's Layer 0 — so next time, even offline, CARpsy retrieves the
corrected answer.

```
CARpsy answers a diagnostic question
            ↓
  Claude evaluates score 1–5 (background, non-blocking)
            │
    score ≥ 3 ──► log "acceptable"
            │
    score < 3 ──► Claude correction → stored in SHIMI Layer 0
                  Next time, CARpsy retrieves the correct answer
                  (even offline — it's in MMKV)
```

Over sessions, SHIMI grows from validated knowledge. The on-device model effectively
gets smarter **without retraining its weights**.

---

## End-to-end data flow

```
ELM327 (BT) → OBDRepositoryImpl → obdStore
                                        ↓
                              useDiagnosticsVM
                                        ↓
                              MultiAgentChatUseCase
                              ├── QueryRouter.classifyQuery()
                              │
                              ├── [diagnostic] ChatWithQVACUseCase
                              │     └── LLMRepositoryImpl
                              │           ├── ShimiDataSource.search()
                              │           │   ├── Layer 0: claudeKnowledge
                              │           │   ├── Layer 1: shimiTree (SKOS)
                              │           │   ├── Layer 2: qvacRag (embeddings)
                              │           │   └── Layer 3: evaluatePatterns()
                              │           └── qvacSDK.chat()  ← on-device LLM
                              │
                              └── [general] ClaudeAPIDataSource
                                    └── answer → claudeKnowledge.store()
                                                      ↓
                                                  SHIMI Layer 0 (offline reuse)
                                    [background] evaluateResponse()
                                                  ↓
                                              correction → SHIMI Layer 0
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
