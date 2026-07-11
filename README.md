# OBDient 🚗🧠

> **📄 README (you are here)** · 🎤 [Pitch](./PITCH.md) · 🧠 [Vision](./VISION.md) · 📸 [Artifacts](./ARTIFACTS.md) · 🔧 [Reproducibility](./artifacts/hardware/README.md)

**Your car, explained — privately, on your phone.**

OBDient plugs into any ELM327 OBD-II adapter, reads your engine in real time, and
diagnoses faults in plain language using a **compact AI model that runs 100%
on-device** through the [QVAC SDK](https://docs.qvac.tether.io/) — no cloud needed
for the core diagnosis.

> Built for the Tether QVAC Hackathon — **Mobile track**.

### 🎥 Watch the 2-minute demo

[![OBDient demo — on-device AI car diagnostics](https://img.youtube.com/vi/AU2e477oyn0/maxresdefault.jpg)](https://youtu.be/mNo5SzqYsbA?si=82YyBD1KvCnMX0c4)

> Real phone, real ELM327 adapter, real car — diagnosing live, fully on-device.

> 📸 **Prefer stills?** See **[ARTIFACTS.md](./ARTIFACTS.md)** — hardware photos,
> app screenshots of the full flow, and the on-device inference logs.

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

### 🧠 A clean on-device model — and the system that makes it smart

**CARpsy** is OBDient's on-device diagnostic assistant. By default it runs a **stock
Qwen3-1.7B** (Q4_K_M, ~1.6 GB RAM) locally via the QVAC SDK, fully offline; low-RAM
devices fall back to Llama 3.2 1B automatically.

We *did* fine-tune a specialist — **CARpsy-v2** (Qwen3-0.6B) — and the training
pipeline and weights are open. But we **ship the clean instruct model by default**:
under our multi-agent design the local model's job is **interviewing, offline
fallback, and RAG narration**, and a clean general model beats a damaged specialist
there (the 0.6B fine-tune leaked training artifacts into responses). The edge isn't
the weights — it's the **system around them**: the SHIMI graph, 4-layer retrieval,
the deterministic gate, and multi-agent routing. The fine-tune stays selectable as a
custom model for A/B.

- 🔧 Training code & data pipeline: **[github.com/gazzimon/CARpsy](https://github.com/gazzimon/CARpsy)**
- 📦 Fine-tuned weights (optional / A-B): **[gazzimon/CARpsy-v2-qwen3-0.6b-GGUF](https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF)**

### 🤝 Multi-agent by design

Instead of one chatbot, OBDient splits the job across roles driven by a **deterministic
state machine** — no ML router, so routing is instant, auditable, and free. The private
on-device path is the default: a template **interviewer** collects the case (0 tokens),
then the **junior** (CARpsy) diagnoses from it, grounded by 4-layer retrieval — all
offline. The cloud is a single **opt-in** escalation: a **senior advisor** (Claude)
reached *only* when the owner asks, and it never receives the VIN, plate, or raw sensor
readings. Every diagnosis is **gate-checked** against the car's real data before it
earns authority (a filter, not a retry loop).

See the full phase-by-phase flow in **How it works** below.

### 🔗 Decentralized knowledge sharing — fedRAG (on-device; cross-device replication verified over the DHT)

A peer-to-peer **federated RAG** over [Hypercore + Hyperswarm](https://holepunch.to),
running inside a **Bare worklet** — a Node-compatible runtime alongside Hermes, so the
real Hypercore/Hyperswarm stack executes on the phone. The device discovers peers
through a shared DHT topic and replicates append-only feeds with **no central server**.

- **End-to-end encrypted** transport (Hyperswarm's Noise protocol) over
  **cryptographically signed, append-only logs** (tamper-evident by design).
- **Privacy contract:** what leaves the device is a **redacted diagnostic case** — a
  gate-checked senior diagnosis plus its structured brief — carrying **no VIN, no
  Bluetooth address, no user ID** (redacted by construction). Joining the network and
  contributing cases are **two separate opt-in toggles**, both off by default.
- **Trust-gated:** incoming knowledge is weighted by peer reputation and must reach a
  **quorum of confirmations** before it can influence a diagnosis.

> **⚠️ Status — full transparency.** At hackathon time OBDient was only ever installed
> on a **single device**, so P2P sync was unproven. **Since then, cross-device
> replication has been verified end-to-end over the real Hyperswarm DHT:** the phone
> discovers a peer, completes the OBDIENT-RAG/1 handshake, replicates feeds
> **bidirectionally**, ingests live blocks **continuously**, and contributes a redacted
> case that a separate seed peer ingests. The one path still unexercised is **two
> physical phones** peer-to-peer — verification ran phone ↔ a PC peer/seed over the real
> DHT, not handset ↔ handset. CARpsy, SHIMI, the 4-layer RAG, human distillation, and
> the trust registry all run today on real hardware.


📖 **Deep dive:** the full intake → junior → senior pipeline, the 4-layer retrieval
pipeline, the gate + knowledge-return learning loop, and the end-to-end data flow now
live in **[docs/INTELLIGENCE.md](docs/INTELLIGENCE.md)**.

---

## AI models

| Model | Role | Size | Runs |
|-------|------|------|------|
| **Qwen3-1.7B** (Q4_K_M) — CARpsy default | Diagnostic chat + interpretation | ~1.6 GB RAM | On-device via QVAC SDK |
| **[CARpsy-v2](https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF)** (Qwen3-0.6B fine-tune, optional) | Specialist A/B — load as custom model | ~0.5 GB RAM | On-device via QVAC SDK |
| **Llama 3.2 1B** (Q4_0) | Automatic low-RAM fallback | ~0.9 GB RAM | On-device via QVAC SDK |
| **EmbeddingGemma 300M** (4-bit) | RAG vector embeddings | ~300 MB RAM | On-device via QVAC SDK |
| **Claude Sonnet** | Senior diagnostic advisor | — | Cloud (opt-in) |

The **primary AI path is 100% on-device**. Cloud is opt-in — one well-fed senior call
the owner explicitly requests, never an automatic per-message hop.

---

## Hackathon compliance (QVAC requirements)

| Requirement | Status | Where |
|---|---|---|
| All primary AI inference via QVAC SDK | ✅ | `qvac-sdk.datasource.ts`, `qvac-rag.datasource.ts` |
| RAG via QVAC SDK | ✅ | `qvac-rag.datasource.ts` + SHIMI 4-layer pipeline |
| Runs on real consumer hardware (Mobile track) | ✅ | Android phone + ELM327 |
| Structured performance audit (loads, tokens, TTFT, tok/s) | ✅ | `audit-*.jsonl` via `src/core/utils/audit-log.ts` |
| Reproducibility + hardware setup instructions | ✅ | This README |
| Complete artifacts (logs, demo, hardware proof) | ✅ | [ARTIFACTS.md](./ARTIFACTS.md) — photos, screenshots, on-device logs, demo video |

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
- Decodes VIN (make / model / year) via the keyless NHTSA vPIC API — no key embedded.
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
| Free storage | ~1.5 GB for on-device models |

> A **physical Android device is required.** Bluetooth Classic and native modules
> (QVAC SDK Bare runtime, MMKV) don't work on the Android emulator or Expo Go.

**OBD-II adapter:** standard ELM327 Bluetooth (Classic, not BLE-only). Pair in
Android Settings → Bluetooth first (typical PIN `1234` or `0000`). Tested with
[this adapter](https://www.amazon.com/-/es/dp/B07CP5ZJVQ) (ASIN `B07CP5ZJVQ`); any
Bluetooth Classic ELM327 clone should work.

---

## Setup & run

### ⬇️ Quickest path — download the APK

No dev environment needed. Grab the pre-built release and install it on an Android phone:

> **📦 [Download OBDient APK (latest release)](https://github.com/gazzimon/OBDient/releases/download/v1.0-hackathon/obdient-release.apk)** (~490 MB)
>
> Or browse the [Releases page](https://github.com/gazzimon/OBDient/releases/tag/v1.0-hackathon).

1. Download the APK, copy it to the phone, and install it (allow "install from unknown sources").
2. Open the app → **Settings → QVAC Assistant → Load model** (downloads the model once, ~1.1 GB).
3. Pair the ELM327 in Android Bluetooth settings (PIN `1234`), then **Settings → Scan Paired Devices** → tap the adapter.

> The APK is signed with the standard Android **debug key**, so Android may warn it's
> from an unidentified developer — expected for a hackathon artifact. A **physical
> Android device is required** (Bluetooth Classic + the QVAC runtime don't work on emulators).

### 🛠️ Build from source

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

1. **Settings → QVAC Assistant → Load model** — downloads the model once (~1.1 GB).
2. Plug the ELM327 into the car's OBD-II port and turn the ignition on.
3. Pair the adapter in Android Bluetooth settings (PIN `1234`).
4. **Settings → Scan Paired Devices** → tap the adapter to connect.
5. Open **Dashboard / Diagnostics** — live data and AI chat are ready.
6. *(Optional)* **Settings → Claude AI** — paste your Anthropic key to enable the
   opt-in cloud senior advisor (summoned only when you tap "senior review").

---

## Configuration (`.env`)

**The app ships with no embedded API keys.** VIN decoding uses the keyless NHTSA vPIC
API. The Claude senior-review key is **not** an env var — `EXPO_PUBLIC_*` values are
inlined into the public JS bundle by Metro, so an embedded key is extractable from the
APK. The user supplies their own Anthropic key at runtime in **Settings → Claude AI**;
it is stored on-device only. Diagnostic AI (CARpsy, SHIMI, RAG) needs no API keys — it
runs fully on-device.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run android` | Build + run dev client on Android |
| `npm start` | Start Metro bundler only |
| `npm test` | Run the Jest suite (hermetic; set `RUN_LLM_INTEGRATION=1` to also run the live-LLM stack test) |
| `npm run db:generate` | Generate Drizzle SQLite migrations |
| `./scripts/capture-logs.ps1` | Capture an on-device runtime session to `artifacts/logs/` |
| `./scripts/extract-audit.ps1` | Extract the structured `audit-*.jsonl` (loads, tokens, TTFT, tok/s) from a session log |

---

## Documentation

- 🧠 **[docs/INTELLIGENCE.md](docs/INTELLIGENCE.md)** — full intelligence architecture
  (intake → junior → senior pipeline, 4-layer retrieval, gate + knowledge-return loop, data flow).
- 🗺️ **[docs/ROADMAP.md](docs/ROADMAP.md)** — the path toward a self-sufficient CARpsy.
- ✅ **[docs/QA-agent-intelligence.md](docs/QA-agent-intelligence.md)** — change log of
  every improvement to the AI stack.

---

## Built by FIUI 🌎

OBDient is built by **FIUI — Fundación Iniciativa Urbana Inteligente**
([fiui.org.ar](https://fiui.org.ar)), a technology NGO in **Misiones, Argentina**
building human-centered, **"AI for the edge"** solutions and mentoring the next
generation of local developers. Privacy-respecting, on-device intelligence —
OBDient is exactly that philosophy applied to your car.

We're hiring senior developers and architects who share the vision → reach us at
[wa.me/5493764876249](https://wa.me/5493764876249).

---

## License

See [LICENSE](./LICENSE).
