# OBDient

**An on-device AI co-pilot for your car.** OBDient connects to a standard ELM327
OBD-II adapter over Bluetooth, reads live engine data and fault codes, and explains
what's going on in plain language — with primary AI inference running **100% locally
on the phone** via the [QVAC SDK](https://docs.qvac.tether.io/).

> Built for the Tether QVAC Hackathon — **Mobile track**.

---

## What it does

- Connects to any ELM327 Bluetooth OBD-II adapter (Bluetooth Classic / SPP).
- Streams **20 real-time OBD-II parameters** (RPM, coolant, speed, fuel trims, O2 sensors, catalyst temp, timing advance, …) on a live dashboard.
- Reads and clears DTC trouble codes with severity classification.
- Generates a natural-language diagnostic assessment **on-device** with CARpsy (Qwen3-0.6B, fine-tuned).
- **Multi-agent conversational chat**: diagnostic queries → CARpsy (on-device, private); general automotive questions → Claude API (cloud).
- **4-layer knowledge retrieval** on every response: Claude-learned knowledge → SHIMI hierarchical tree → QVAC RAG vectors → Hypercore patterns.
- **Quality evaluator**: Claude silently scores CARpsy responses in background and stores corrections into SHIMI — the model gets smarter over sessions without retraining.
- Voice output and hands-free alerts while driving.
- Decodes VIN (make / model / year / plant) via local lookup and Vincario API.
- Auto-disconnects after configurable idle period when RPM = 0, protecting battery.
- **Persistent sessions**: full conversation history saved to local SQLite for later review in Reports.
- **Distributed RAG** — P2P knowledge network (Hypercore + Hyperswarm) shares anonymous diagnostic patterns across devices with no server and no PII.

The car's data never leaves the device without explicit consent.

---

## Intelligence architecture

### Two-agent system

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

### 4-layer knowledge retrieval pipeline

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
  │           Semantic similarity over OBD-II knowledge corpus
  │
  └─ Layer 3: Hypercore pattern evaluator
              Rule-based patterns validated by P2P peer consensus
```

### Quality evaluator loop

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

Over sessions, SHIMI grows from Claude's validated knowledge. The on-device model
effectively gets smarter without retraining its weights.

---

## AI models

| Model | Role | Size | Runs |
|-------|------|------|------|
| **CARpsy** (Qwen3-0.6B Q4_K_M) | Diagnostic chat + interpretation | ~400 MB RAM | On-device via QVAC SDK |
| **EmbeddingGemma 300M** (4-bit) | RAG vector embeddings | ~300 MB RAM | On-device via QVAC SDK |
| **Claude Haiku** | General questions + quality eval | — | Cloud (optional) |

Primary AI path (diagnostics, DTC analysis) is 100% on-device. Cloud is opt-in for
general questions and background quality evaluation only.

---

## On-device RAG (QVAC)

Before each response, OBDient retrieves relevant repair knowledge from a local vector
store and feeds it as grounding context — no internet required.

- **Embedding model**: EmbeddingGemma 300M (4-bit), loaded from Settings alongside CARpsy.
- **Knowledge corpus**: curated OBD-II DTC knowledge in `src/data/knowledge/obd-knowledge.ts`,
  ingested once into a persistent QVAC workspace.
- **Retrieval**: `src/data/datasources/shimi.datasource.ts` — merges all 4 layers,
  deduplicates, caps snippets at 300 chars each to stay within CARpsy's context window.
- **Graceful degradation**: any layer failure returns `[]`; the assistant still answers
  from live OBD data.

---

## SHIMI — confidence-weighted knowledge tree

SHIMI (*Semantic Hierarchical Index with Memory Integration*) is an on-device knowledge
graph built from the OBD-II SKOS ontology. Each node tracks a confidence score updated
by peer confirmations and Claude quality evaluations.

```
P0300 (Random Misfire)
  └─ misfire_random  [confidence: 0.87]
       ├─ ignition   [confidence: 0.91]
       ├─ fuel_system [confidence: 0.74]
       └─ powertrain  [confidence: 0.95]
```

When a DTC is active, SHIMI returns the highest-confidence content from the entire
subtree — not just the exact code match. This means a P0301 query also retrieves
ignition system and fuel system knowledge.

Key files: `src/data/knowledge/shimi-tree.ts`, `src/data/knowledge/obd-ontology.ts`

---

## Distributed RAG (Hypercore, opt-in)

OBDient extends local RAG with a **federated knowledge layer** built on
[Hypercore](https://holepunch.to) and Hyperswarm. Each device maintains a local
append-only feed of anonymous diagnostic chunks; instances discover each other via a
shared DHT topic (`obdient-rag-v1`) and replicate feeds without a central server.

**Privacy contract:**
- Chunks never include VIN, Bluetooth address, or any user identifier.
- Only DTC code, make, approximate year range, anonymised assessment text, and a
  confidence score are shared.
- Joining the network and contributing knowledge are **separate opt-in toggles** (both off by default).
- Remote chunks must reach `confirmations ≥ 3` before surfacing in context.

> Current status: Hypercore/Hyperswarm are stubbed in the APK (no Node.js runtime in Hermes).
> SHIMI tree, SKOS, trust registry, pattern evaluator, and local RAG all work fully.

---

## Live OBD-II parameters (20 PIDs)

| PID | Command | Metric |
|-----|---------|--------|
| Engine RPM | `010C` | rpm |
| Vehicle Speed | `010D` | km/h |
| Coolant Temp | `0105` | °C |
| Engine Load | `0104` | % |
| Mass Air Flow | `0110` | g/s |
| Throttle Position | `0111` | % |
| Intake Air Temp | `010F` | °C |
| Battery Voltage | `ATRV` | V |
| Short Term Fuel Trim | `0106` | % |
| Long Term Fuel Trim | `0107` | % ⚠️ alerts at ±15% |
| Timing Advance | `010E` | ° |
| Intake MAP | `010B` | kPa |
| O2 Sensor B1S1 | `0114` | V |
| O2 Sensor B1S2 | `0115` | V |
| Engine Run Time | `011F` | s |
| Fuel Level | `012F` | % |
| Barometric Pressure | `0133` | kPa |
| Catalyst Temperature | `013C` | °C |
| Relative Throttle | `0145` | % |
| Ambient Temperature | `0146` | °C |

Contextual alerts: battery voltage check while engine running (expected 13.5–14.5V),
LTFT/STFT ±15%, catalyst temp >900°C, fuel level <10%.

---

## Architecture

Clean architecture, framework-agnostic core:

```
src/
├── app/            # expo-router screens (dashboard, diagnostics, reports, settings)
├── core/           # constants (PIDs), errors, types, OBD/DTC parsers
├── domain/         # entities, repository interfaces, use cases (pure TS)
├── data/           # datasources (QVAC, RAG, Claude API, Hypercore, BT, DB), repositories
├── presentation/   # components, hooks, providers, view-models
└── store/          # Zustand stores (obd, session, settings)
```

### Key data flow

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

## Hardware requirements

| Item         | Requirement                                              |
|--------------|----------------------------------------------------------|
| OS           | Android 10+ (`minSdkVersion 29`)                         |
| RAM          | 4 GB minimum, 6 GB+ recommended                          |
| Connectivity | Bluetooth Classic (for ELM327 adapter)                   |
| Free storage | ~1 GB for on-device models                               |

> A **physical Android device is required.** Bluetooth Classic and native modules
> (QVAC SDK Bare runtime, MMKV) do not work on the Android emulator or Expo Go.

**OBD-II adapter:** Standard ELM327 Bluetooth (Classic, not BLE-only). Pair in
Android Settings → Bluetooth first (typical PIN: `1234` or `0000`).

---

## Prerequisites

- **Node.js 20+** and npm
- **JDK 17** and **Android SDK** (Android Studio) with USB debugging set up
- A physical Android phone with developer mode enabled

---

## Setup & run

```bash
# 1. Clone
git clone https://github.com/gazzimon/OBDient.git
cd OBDient

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — add your Anthropic key for Claude cloud features (optional).
# AI diagnostics work fully offline without any API keys.

# 4. Connect Android phone via USB (USB debugging ON), then:
npm run android
# Builds a custom dev client with Gradle and installs it on the phone.
# First build takes several minutes.
```

On the device:

1. **Settings → QVAC Assistant → Load model** — downloads CARpsy once (~400 MB).
2. Plug ELM327 into the car's OBD-II port and turn ignition on.
3. Pair adapter in Android Bluetooth settings (PIN `1234`).
4. **Settings → Scan Paired Devices** → tap adapter to connect.
5. Go to **Dashboard / Diagnostics** — live data and AI chat are ready.

To enable Claude cloud features:

6. **Settings → Claude AI** — paste your Anthropic API key.
   General questions now route to Claude; quality evaluation runs in background.
   The badge shows how many knowledge entries CARpsy has learned from Claude.

---

## Configuration (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `EXPO_PUBLIC_VINCARIO_API_KEY` | No | Online VIN decode (Vincario API) |
| `EXPO_PUBLIC_VINCARIO_SECRET_KEY` | No | Online VIN decode (Vincario API) |
| `EXPO_PUBLIC_ANTHROPIC_API_KEY` | No | Claude cloud fallback + quality evaluator |

Diagnostic AI (CARpsy, SHIMI, RAG) needs **no API keys** — runs fully on-device.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run android` | Build + run dev client on Android |
| `npm start` | Start Metro bundler only |
| `npm test` | Run Jest test suite |
| `npm run db:generate` | Generate Drizzle SQLite migrations |

---

## Hackathon compliance (QVAC requirements)

| Requirement | Status | Where |
|---|---|---|
| All primary AI inference via QVAC SDK | ✅ | `qvac-sdk.datasource.ts`, `qvac-rag.datasource.ts` |
| RAG via QVAC SDK | ✅ | `qvac-rag.datasource.ts` + SHIMI 4-layer pipeline |
| Runs on real consumer hardware (Mobile track) | ✅ | Android phone + ELM327 |
| Reproducibility + hardware setup instructions | ✅ | This README |
| Complete artifacts (logs, demo, hardware proof) | 🚧 | See `/artifacts` |

> Cloud (Claude API) is an optional enhancement layer only — all mandatory QVAC
> inference paths use the on-device SDK exclusively.

---

## License

See [LICENSE](./LICENSE).
