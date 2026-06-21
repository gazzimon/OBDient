# OBDient 🚗🧠

**Your car, explained — privately, on your phone.**

OBDient plugs into any ELM327 OBD-II adapter, reads your engine in real time, and
diagnoses faults in plain language using a **self-trained AI model that runs 100%
on-device** through the [QVAC SDK](https://docs.qvac.tether.io/) — no cloud needed
for the core diagnosis.

> Built for the Tether QVAC Hackathon — **Mobile track**.

### 🎥 Watch the 2-minute demo

[![OBDient demo — on-device AI car diagnostics](https://img.youtube.com/vi/AU2e477oyn0/maxresdefault.jpg)](https://youtu.be/AU2e477oyn0)

> Real phone, real ELM327 adapter, real car — diagnosing live, fully on-device.

---

## Why OBDient is different

Most diagnostic apps are just a cloud LLM behind a chat box. OBDient is a private,
self-improving, multi-agent diagnostic brain that lives **on the phone**.

### 🕸️ The hook — a Hierarchical Semantic RAG, not a flat vector index

We call it our **"Semantic Web 4.0"**. Underneath the name, it's something a
technical jury can verify: **SHIMI**, an evolving, confidence-weighted
**knowledge graph** built on a real SKOS ontology.

A normal RAG throws your query at a pile of text chunks and returns whatever looks
similar — a *flat* lookup. SHIMI instead **reasons through a hierarchy of meaning**:

```
P0301 (cylinder-1 misfire)
   └─ misfire_random        ← the canonical concept
        ├─ ignition         ← ancestor knowledge
        ├─ fuel_system      ← related branch
        └─ powertrain       ← parent domain
```

So a question about one fault code automatically pulls in **ignition and
fuel-system knowledge too** — the way a real mechanic thinks, not the way a search
box guesses. Every node carries a **confidence score** that goes up as answers get
validated, so the graph doesn't just grow — it gets *more trustworthy* over time.

> **In one line:** flat RAG finds *similar words*; SHIMI retrieves *related
> meaning, ranked by how much we trust it*.

### 🙋 Human distillation — the RAG that learns from its driver

Every answer can be rated 👍 / 👎. That feedback isn't cosmetic: it **distills**
human judgment straight into the knowledge graph. Verified knowledge is kept
**separate** from unverified, which is how OBDient actively fights hallucinations.

This creates a virtuous cycle — written here in both registers so anyone gets it:

| What happens (plain) | What it means (technical) |
|---|---|
| **More diagnoses get validated** | Human-in-the-loop labels accumulate as ground-truth signals |
| **The RAG gets denser** | Validated Q→A pairs are promoted into SHIMI, raising retrieval coverage and confidence |
| **The whole flow gets smarter** | The on-device model retrieves verified answers directly, even offline |
| **Cloud (Claude) calls drop** | Fewer queries escalate — the system trends toward full local self-sufficiency |

The endgame: **Claude teaches → the human (and the car) verify → SHIMI accumulates
→ CARpsy needs the cloud less → repeat.** The phone gets smarter without retraining
the model's weights.

### 🧠 Our own fine-tuned model — not an off-the-shelf API

**CARpsy** is a Qwen3-0.6B we fine-tuned specifically for OBD-II diagnostics. It
runs locally via the QVAC SDK (~400 MB RAM, works offline).

- 🔧 Training code & data pipeline: **[github.com/gazzimon/CARpsy](https://github.com/gazzimon/CARpsy)**
- 📦 Quantized weights: **[gazzimon/CARpsy-v2-qwen3-0.6b-GGUF](https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF)**

### 🤝 Multi-agent by design

A **deterministic router** (no ML, no latency) splits every message across roles:

- **Diagnostician** — CARpsy, on-device, private, offline-capable (DTCs, sensors, faults).
- **Generalist** — Claude (cloud, opt-in) for open automotive questions; receives
  make/model/year + the question only — **never** the VIN or raw sensor readings.
- **Quality-Evaluator** — Claude scores CARpsy's answers in the background and feeds
  corrections back into SHIMI.
- **Retriever** — the 4-layer knowledge pipeline (Claude-learned → SHIMI → vector RAG
  → P2P patterns) that grounds every reply.

### 🔗 Decentralized knowledge sharing — fedRAG (base code, see status)

A peer-to-peer **federated RAG** over [Hypercore + Hyperswarm](https://holepunch.to):
each device keeps an append-only feed of **anonymous** diagnostic chunks, discovers
peers through a shared DHT topic, and replicates with **no central server**.

- **End-to-end encrypted** transport (Hyperswarm's Noise protocol) over
  **cryptographically signed, append-only logs** (tamper-evident by design).
- **Privacy contract:** chunks never carry VIN, Bluetooth address, or any user ID —
  only DTC code, make, an approximate year range, anonymized text, and a confidence
  score. Joining and contributing are **two separate opt-in toggles**, both off by default.
- **Trust-gated:** remote knowledge is weighted by peer reputation and must reach a
  **quorum of confirmations** before it can influence a diagnosis.

> **⚠️ Status — full transparency.** The federated layer is **written and compiles,
> but it has never been exercised peer-to-peer.** During the hackathon OBDient was
> only ever installed on a **single device**, so cross-device replication was never
> tested — and the runtime is currently **stubbed** anyway, because Hermes (React
> Native's JS engine) has no Node.js host to run Hypercore. **Treat fedRAG as
> architected base code, not a demonstrated feature.** Everything else in this list
> — CARpsy, SHIMI, the 4-layer RAG, human distillation, the trust registry — runs
> today on real hardware.

---

## How it works (at a glance)

```
        User message
             │
        ┌────▼─────┐  deterministic, no ML
        │  Router  │
        └────┬─────┘
   diagnostic│           general
       ┌─────┴─────┐  ┌──────────────┐
       ▼           │  ▼              │
   CARpsy          │  Claude (cloud, opt-in)
   on-device       │  make/model/year + question only
       │           │  └─ answer stored locally for offline reuse
       ▼           │
  4-layer RAG ─────┘
   ├─ Claude-learned knowledge
   ├─ SHIMI hierarchical graph (SKOS)
   ├─ on-device vector RAG (EmbeddingGemma)
   └─ P2P pattern layer (fedRAG)
       │
       ▼
   Grounded, plain-language diagnosis
   + background Quality-Evaluator → corrections back into SHIMI
```

📖 **Deep dive:** the full two-agent system, the 4-layer retrieval pipeline, the
quality-evaluator loop, and the end-to-end data flow now live in
**[docs/INTELLIGENCE.md](docs/INTELLIGENCE.md)**.

---

## AI models

| Model | Role | Size | Runs |
|-------|------|------|------|
| **[CARpsy](https://github.com/gazzimon/CARpsy)** (Qwen3-0.6B Q4_K_M) | Diagnostic chat + interpretation | ~400 MB RAM | On-device via QVAC SDK |
| **EmbeddingGemma 300M** (4-bit) | RAG vector embeddings | ~300 MB RAM | On-device via QVAC SDK |
| **Claude Haiku** | General questions + quality eval | — | Cloud (opt-in) |

The **primary AI path is 100% on-device**. Cloud is opt-in, for general questions
and background quality evaluation only.

---

## Hackathon compliance (QVAC requirements)

| Requirement | Status | Where |
|---|---|---|
| All primary AI inference via QVAC SDK | ✅ | `qvac-sdk.datasource.ts`, `qvac-rag.datasource.ts` |
| RAG via QVAC SDK | ✅ | `qvac-rag.datasource.ts` + SHIMI 4-layer pipeline |
| Runs on real consumer hardware (Mobile track) | ✅ | Android phone + ELM327 |
| Reproducibility + hardware setup instructions | ✅ | This README |
| Complete artifacts (logs, demo, hardware proof) | ✅ | [artifacts/](artifacts/) — demo video, on-device logs, hardware proof |

> Cloud (Claude API) is an optional enhancement only — every mandatory QVAC
> inference path uses the on-device SDK exclusively.

---

## What it does (feature list)

- Connects to any ELM327 Bluetooth OBD-II adapter (Bluetooth Classic / SPP).
- Streams **20 real-time OBD-II parameters** on a live dashboard (RPM, coolant,
  speed, fuel trims, O2 sensors, catalyst temp, timing advance, …).
- Reads and clears DTC trouble codes with severity classification.
- Generates a natural-language diagnostic assessment **on-device** with CARpsy.
- **Multi-agent chat** + **4-layer knowledge retrieval** on every response.
- **Human distillation:** 👍/👎 feedback updates SHIMI confidence; verified
  knowledge is separated from unverified.
- Voice output and hands-free alerts while driving.
- Decodes VIN (make / model / year / plant) via local lookup + Vincario API.
- Auto-disconnects after a configurable idle period (RPM = 0) to protect the battery.
- **Persistent sessions** saved to local SQLite for later review in Reports.

The car's data never leaves the device without explicit consent.

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

Alert thresholds (LTFT/STFT ±15%, catalyst >900 °C, fuel <10%, battery out of range)
are declared per-PID in `src/core/constants/pids.ts` — never hardcoded into the
model's prompt.

---

## Architecture

Clean architecture, framework-agnostic core:

```
src/
├── app/            # expo-router screens (dashboard, diagnostics, reports, settings)
├── core/           # constants (PIDs), errors, types, OBD/DTC parsers
├── domain/         # entities, repository interfaces, use cases (pure TS)
├── data/           # datasources (QVAC, RAG, Claude, Hypercore, BT, DB), repositories
├── presentation/   # components, hooks, providers, view-models
└── store/          # Zustand stores (obd, session, settings)
```

---

## Hardware requirements

| Item | Requirement |
|------|-------------|
| OS | Android 10+ (`minSdkVersion 29`) |
| RAM | 4 GB minimum, 6 GB+ recommended |
| Connectivity | Bluetooth Classic (for ELM327 adapter) |
| Free storage | ~1 GB for on-device models |

> A **physical Android device is required.** Bluetooth Classic and native modules
> (QVAC SDK Bare runtime, MMKV) don't work on the Android emulator or Expo Go.

**OBD-II adapter:** standard ELM327 Bluetooth (Classic, not BLE-only). Pair in
Android Settings → Bluetooth first (typical PIN `1234` or `0000`). Tested with
[this adapter](https://www.amazon.com/-/es/dp/B07CP5ZJVQ) (ASIN `B07CP5ZJVQ`); any
Bluetooth Classic ELM327 clone should work.

---

## Setup & run

```bash
# 1. Clone
git clone https://github.com/gazzimon/OBDient.git
cd OBDient

# 2. Install dependencies
npm install

# 3. Configure environment (optional — diagnostics work fully offline)
cp .env.example .env
# Add your Anthropic key for Claude cloud features if you want them.

# 4. Connect an Android phone via USB (USB debugging ON), then:
npm run android
```

On the device:

1. **Settings → QVAC Assistant → Load model** — downloads CARpsy once (~400 MB).
2. Plug the ELM327 into the car's OBD-II port and turn the ignition on.
3. Pair the adapter in Android Bluetooth settings (PIN `1234`).
4. **Settings → Scan Paired Devices** → tap the adapter to connect.
5. Open **Dashboard / Diagnostics** — live data and AI chat are ready.
6. *(Optional)* **Settings → Claude AI** — paste your Anthropic key to enable the
   cloud Generalist and background Quality-Evaluator.

---

## Configuration (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `EXPO_PUBLIC_VINCARIO_API_KEY` | No | Online VIN decode (Vincario) |
| `EXPO_PUBLIC_VINCARIO_SECRET_KEY` | No | Online VIN decode (Vincario) |
| `EXPO_PUBLIC_ANTHROPIC_API_KEY` | No | Claude cloud fallback + quality evaluator |

Diagnostic AI (CARpsy, SHIMI, RAG) needs **no API keys** — it runs fully on-device.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run android` | Build + run dev client on Android |
| `npm start` | Start Metro bundler only |
| `npm test` | Run Jest test suite |
| `npm run db:generate` | Generate Drizzle SQLite migrations |

---

## Documentation

- 🧠 **[docs/INTELLIGENCE.md](docs/INTELLIGENCE.md)** — full intelligence architecture
  (two-agent system, 4-layer retrieval, quality-evaluator loop, data flow).
- 🗺️ **[docs/ROADMAP.md](docs/ROADMAP.md)** — the path toward a self-sufficient CARpsy.
- ✅ **[docs/QA-agent-intelligence.md](docs/QA-agent-intelligence.md)** — change log of
  every improvement to the AI stack.

---

## License

See [LICENSE](./LICENSE).
