# OBDient

**An on-device AI co-pilot for your car.** OBDient connects to a standard ELM327
OBD-II adapter over Bluetooth, reads live engine data and fault codes, and explains
what's going on in plain language — with all AI inference running **100% locally on
the phone** via the [QVAC SDK](https://docs.qvac.tether.io/). No cloud, no internet
required for inference, no data leaving the device.

> Built for the Tether QVAC Hackathon — **Mobile track**.

---

## What it does

- Connects to any ELM327 Bluetooth OBD-II adapter (Bluetooth Classic / SPP).
- Streams real-time parameters (RPM, coolant temp, speed, battery voltage, …) on a live dashboard.
- Reads and clears DTC trouble codes, with severity classification.
- Generates a natural-language diagnostic assessment **on-device** with QVAC.
- Conversational chat with QVAC inside the Diagnostics screen — ask follow-up questions about active faults.
- Voice output and voice commands (hands-free while driving).
- Decodes the VIN (make / model / year / plant) and cross-references vehicle data.
- Auto-disconnects after a configurable idle period when RPM = 0, protecting the car battery.
- Saves diagnostic sessions to a local SQLite database for later review.
- **Distributed RAG** — joins a P2P knowledge network (Hypercore + Hyperswarm) to share and receive anonymous diagnostic patterns from other OBDient instances, with no server and no PII.

All inference happens on the phone. The car's data never leaves the device.

---

## How the AI runs (QVAC, on-device)

OBDient uses **`@qvac/sdk`** for all AI inference. The model is downloaded once and
loaded into RAM directly on the device; every diagnostic interpretation is a local
`completion()` call — there is **no inference server and no network round-trip**.

- Integration entry point: `src/data/datasources/qvac-sdk.datasource.ts`
  (`loadModel` → `completion` → `unloadModel`).
- Wired through clean architecture: `InterpretWithQVACUseCase` → `ILLMRepository`
  → `LLMRepositoryImpl` → `qvacSDK`.
- Model is loaded from **Settings → QVAC Assistant → Load model** and kept warm for
  fast responses. Once loaded, an **Unload & reload** button lets you swap models
  without restarting the app.
- If the model isn't loaded yet, a deterministic rule-based fallback keeps the app
  safe and usable.
- Default model: `LLAMA_3_2_1B_INST_Q4_0` (4-bit, ~1B params) for low-RAM phones.
- Custom models: Settings accepts any HTTPS URL, local file path, or `pear://` key
  pointing to a fine-tuned GGUF — the custom source is persisted and passed to
  `initialize()` on every load.

> The QVAC SDK is integrated via the Expo config plugin `@qvac/sdk/expo-plugin`
> (see `app.json`). The Bare worker bundle lives in `qvac/`.

### On-device RAG

Before each interpretation, OBDient retrieves the most relevant repair knowledge
from a local vector store and feeds it to the LLM as grounding context — all on the
device, using QVAC's built-in RAG pipeline (`ragIngest` / `ragSearch`).

- Embedding model: `EmbeddingGemma 300M` (4-bit), loaded separately from the chat LLM.
- Knowledge corpus: a curated OBD-II DTC / repair knowledge base in
  `src/data/knowledge/obd-knowledge.ts`, ingested once into a persistent workspace.
- Retrieval glue: `src/data/datasources/qvac-rag.datasource.ts`; the active fault
  codes and alerting parameters form the query, and the top matches are injected
  into the prompt by `LLMRepositoryImpl`.
- Graceful degradation: if the RAG index isn't ready, search returns nothing and the
  assistant still answers from the live OBD data.

### Distributed RAG (Hypercore, opt-in)

OBDient extends local RAG with a **federated knowledge layer** built on
[Hypercore](https://holepunch.to) and Hyperswarm. Each device maintains a local
append-only feed of anonymous diagnostic chunks; instances discover each other via a
shared DHT topic (`obdient-rag-v1`) and replicate feeds without a central server.

```
[OBDient A]  ←── P2P (Hyperswarm) ───►  [OBDient B]
  local feed                               local feed
      ↕  replicate                             ↕  replicate
  in-memory chunks                        in-memory chunks
      ↓                                        ↓
  LLMRepositoryImpl.interpret()           LLMRepositoryImpl.interpret()
  local snippets + remote chunks          local snippets + remote chunks
```

**Privacy contract:**
- Chunks never include VIN, Bluetooth address, or any user identifier.
- Only DTC code, make, approximate year range, anonymised assessment text, and a
  confidence score are shared.
- Joining the network and contributing knowledge are **separate opt-in toggles**
  (both off by default).
- Remote chunks must reach `confirmations ≥ 3` (seen by at least three independent
  peers) before they surface in the RAG context.

Key files:

| File | Role |
|---|---|
| `src/data/datasources/hypercore-knowledge.datasource.ts` | Feed lifecycle, Hyperswarm peer management, in-memory chunk store |
| `src/data/datasources/knowledge-extractor.ts` | Distils a closed session into an anonymous `KnowledgeChunk` |
| `src/data/repositories/llm.repository.impl.ts` | Fuses local + remote snippets before every `interpret()` call |

### P2P on device — current state and roadmap

Hypercore and Hyperswarm depend on Node.js built-ins (`net`, `dgram`, `fs`, `crypto`)
that do not exist in the Hermes / React Native JS runtime. In the current APK, Metro
redirects both packages to no-op stubs at bundle time (`stubs/hypercore.js`,
`stubs/hyperswarm.js`), so the app builds and runs cleanly. Everything except actual
P2P networking is fully functional:

| Layer | Status in APK |
|---|---|
| SHIMI confidence tree (MMKV) | ✅ works |
| SKOS ontology navigation | ✅ works |
| Trust registry (MMKV) | ✅ works |
| Pattern evaluator | ✅ works |
| Local QVAC RAG | ✅ works |
| Hypercore local feed (disk) | 🔲 stubbed |
| Hyperswarm P2P discovery | 🔲 stubbed |

To enable real P2P in a production APK there are two paths:

**Option A — Expo native module (recommended)**
Write a Kotlin/Swift `ExpoModule` that runs Hyperswarm in a background thread and
exposes an event-emitter bridge to JS. The SHIMI tree and all JS-side logic stay
unchanged; only the chunk source changes from in-process to cross-thread.

```
[Hermes / JS thread]           [Kotlin background thread]
  hypercoreKnowledge   ←────   HypercoreExpoModule
  (thin JS wrapper)   events   Hyperswarm DHT  ←→  WiFi/LTE
  shimiTree.applyChunk()       hypercore local feed (disk)
```

Scaffolding: `npx create-expo-module hypercore-native`. Estimated effort: 1–2 sprints.

**Option B — nodejs-mobile-react-native**
Embed a full Node.js runtime inside the APK using
[nodejs-mobile-react-native](https://github.com/nodejs-mobile/nodejs-mobile-react-native).
The existing `hypercore-knowledge.datasource.ts` code runs almost unchanged inside
the Node process; a lightweight message bridge replaces the Metro stubs.

```
[Hermes / JS thread]           [Embedded Node.js process]
  thin bridge wrapper  ←────   hypercore-knowledge.datasource.ts
  (same JS interface)  IPC     (current code, unmodified)
```

Trade-off: APK size increases ~30 MB (embedded Node runtime). Requires switching to
Bare workflow (incompatible with Expo Go managed builds).

---

## Diagnostic chat

The Diagnostics screen includes a conversational QVAC interface. After the initial
AI interpretation, the technician can ask follow-up questions about active DTCs, live
parameters, or repair steps. Chat history is persisted in `sessionStore` for the
duration of the session.

- View model: `src/presentation/viewmodels/useChatVM.ts`
- Use case: `src/domain/usecases/chat-with-qvac.ts`
- UI components: `ChatBubble`, `VehicleHeaderCard` in `src/presentation/components/diagnostics/`

---

## Architecture

Clean architecture, framework-agnostic core:

```
src/
├── app/            # expo-router screens (dashboard, diagnostics, reports, settings)
├── core/           # constants (PIDs), errors, types, OBD/DTC parsers
├── domain/         # entities, repository interfaces, use cases (pure TS)
├── data/           # datasources (QVAC, RAG, Hypercore, BT, DB), repositories, mappers
├── presentation/   # components, hooks, providers, view-models
└── store/          # Zustand stores (obd, session, settings)
```

### Key data flow

```
ELM327 (BT) → OBDRepositoryImpl → obdStore
                                        ↓
                              useDashboardVM / useDiagnosticsVM
                                        ↓
                              InterpretWithQVACUseCase
                                        ↓
                              LLMRepositoryImpl
                              ├── qvacRag.search()        (local embeddings)
                              ├── hypercoreKnowledge.getChunks()  (distributed)
                              └── qvacSDK.interpret()     (on-device LLM)
                                        ↓
                              sessionStore ← endSession() → knowledge-extractor
                                                                    ↓
                                                          hypercore feed (if opted in)
```

---

## Hardware requirements

**Phone (test device used):**

| Item         | Requirement                                              |
|--------------|----------------------------------------------------------|
| OS           | Android 10+ (`minSdkVersion 29`)                         |
| RAM          | 4 GB minimum, 6 GB+ recommended (model loads into RAM)   |
| Connectivity | Bluetooth Classic (for the ELM327 adapter)               |
| Free storage | ~1 GB for the on-device model                            |

> A **physical Android device is required.** The app depends on Bluetooth Classic
> and native modules (Bare runtime, MMKV), which do **not** work on the Android
> emulator or in Expo Go.

**OBD-II adapter:**

- A standard **ELM327 Bluetooth** adapter (Bluetooth Classic, *not* BLE-only).
- Plug it into the car's OBD-II port (usually under the steering wheel).
- Pair it in Android **Settings → Bluetooth** first (typical PIN: `1234` or `0000`).

---

## Prerequisites (software)

- **Node.js 20+** and npm
- **JDK 17** and the **Android SDK** (Android Studio) with USB debugging set up
- An Android phone connected via USB with developer mode enabled

> Expo 56 pins exact native versions. Before changing native code, read the
> versioned docs at <https://docs.expo.dev/versions/v56.0.0/>.

---

## Setup & run

```bash
# 1. Clone
git clone https://github.com/gazzimon/OBDient.git
cd OBDient

# 2. Install dependencies
npm install

# 3. Configure environment (optional — only needed for online VIN decode)
cp .env.example .env
# Edit .env and add your Vincario keys if you have them.
# AI inference and the P2P knowledge network need NO env vars.

# 4. Connect a physical Android phone via USB (USB debugging ON), then:
npm run android
# Builds a custom dev client with Gradle and installs it on the phone.
# The first build takes several minutes.
```

On the device:

1. Open OBDient → **Settings → QVAC Assistant → Load model**
   (downloads the model once; badge turns to `READY`).
2. Plug the ELM327 into the car's OBD-II port and turn the ignition on.
3. Pair the adapter in Android Bluetooth settings (PIN `1234`).
4. In OBDient → **Settings → Scan Paired Devices** → tap your adapter to connect.
5. Go to **Dashboard / Diagnostics** to see live data and AI interpretations.

To try the distributed RAG network:

6. **Settings → Knowledge network → Distributed RAG** → enable.
7. Optionally enable **Contribute knowledge** to share anonymous DTC patterns.
8. The peer badge shows connected peers in real time (refreshes every 5 s).

---

## Configuration (`.env`)

| Variable                          | Required | Purpose                          |
|-----------------------------------|----------|----------------------------------|
| `EXPO_PUBLIC_VINCARIO_API_KEY`    | No       | Online VIN decode (Vincario API) |
| `EXPO_PUBLIC_VINCARIO_SECRET_KEY` | No       | Online VIN decode (Vincario API) |

There is **no** AI/model/base-URL variable: inference is on-device by design.

---

## Scripts

| Command               | Description                                        |
|-----------------------|----------------------------------------------------|
| `npm run android`     | Build + run the dev client on Android              |
| `npm start`           | Start the Metro bundler                            |
| `npm test`            | Run the Jest test suite                            |
| `npm run db:generate` | Generate Drizzle SQLite migrations                 |
| `npm run db:studio`   | Open Drizzle Studio                                |
| `node scripts/test-hypercore-local.js` | Hypercore v11 smoke test (Node only, no device needed) |

---

## Testing

```bash
npm test
```

Unit tests cover the OBD/DTC parsers, VIN mapping, the SHA-1 helper, and the
connect-to-vehicle use case (`src/__tests__/`).

---

## Hackathon compliance (QVAC requirements)

| Mandatory requirement                          | Status | Where                                                 |
|------------------------------------------------|--------|-------------------------------------------------------|
| All AI inference via QVAC SDK                  | ✅     | `src/data/datasources/qvac-sdk.datasource.ts`         |
| RAG via QVAC SDK                               | ✅     | `src/data/datasources/qvac-rag.datasource.ts`         |
| Runs on real consumer hardware (Mobile track)  | ✅     | Android phone + ELM327, this README                   |
| Reproducibility + hardware setup instructions  | ✅     | This README                                           |
| Complete artifacts (logs, demo, hardware proof)| 🚧     | See `/artifacts` (demo video, profiler logs)          |

---

## License

See [LICENSE](./LICENSE).
