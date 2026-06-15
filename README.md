# OBDient

**An on-device AI co-pilot for your car.** OBDient connects to a standard ELM327
OBD-II adapter over Bluetooth, reads live engine data and fault codes, and explains
what's going on in plain language — with all AI inference running **100% locally on
the phone** via the [QVAC SDK](https://docs.qvac.tether.io/). No cloud, no internet
required for inference, no data leaving the device.

> Built for the Tether QVAC Hackathon — **Mobile track**.

---

## What it does

- 📲 Connects to any ELM327 Bluetooth OBD-II adapter (Bluetooth Classic / SPP).
- 📊 Streams real-time parameters (RPM, coolant temp, speed, battery voltage, …) on a live dashboard.
- 🩺 Reads and clears DTC trouble codes, with severity classification.
- 🧠 Generates a natural-language diagnostic assessment **on-device** with QVAC.
- 🔊 Voice output and voice commands (hands-free while driving).
- 🚗 Decodes the VIN (make / model / year / plant) and cross-references vehicle data.
- 💾 Saves diagnostic sessions to a local SQLite database for later review.

All inference happens on the phone. The car's data never leaves the device.

## How the AI runs (QVAC, on-device)

OBDient uses **`@qvac/sdk`** for all AI inference. The model is downloaded once and
loaded into RAM directly on the device; every diagnostic interpretation is a local
`completion()` call — there is **no inference server and no network round-trip**.

- Integration entry point: `src/data/datasources/qvac-sdk.datasource.ts`
  (`loadModel` → `completion` → `unloadModel`).
- Wired through clean architecture: `InterpretWithQVACUseCase` → `ILLMRepository`
  → `LLMRepositoryImpl` → `qvacSDK`.
- Model is loaded from **Settings → QVAC Assistant → Load model** and kept warm for
  fast responses. If the model isn't loaded yet, a deterministic rule-based fallback
  keeps the app safe and usable.
- Current model: `LLAMA_3_2_1B_INST_Q4_0` (4-bit, ~1B params) for low-RAM phones.

> The QVAC SDK is integrated via the Expo config plugin `@qvac/sdk/expo-plugin`
> (see `app.json`). The Bare worker bundle lives in `qvac/`.

## Architecture

Clean architecture, framework-agnostic core:

```
src/
├── app/            # expo-router screens (dashboard, diagnostics, reports, settings)
├── core/           # constants (PIDs), errors, types, OBD/DTC parsers
├── domain/         # entities, repository interfaces, use cases (pure business logic)
├── data/           # datasources, repository implementations, DB schema, mappers
├── presentation/   # components, hooks, providers, view-models
└── store/          # Zustand stores (obd, session, settings)
```

## Hardware requirements

**Phone (test device used):**

| Item            | Requirement                                              |
|-----------------|----------------------------------------------------------|
| OS              | Android 10+ (`minSdkVersion 29`)                         |
| RAM             | 4 GB minimum, 6 GB+ recommended (model loads into RAM)  |
| Connectivity    | Bluetooth Classic (for the ELM327 adapter)              |
| Free storage    | ~1 GB for the on-device model                           |

> ⚠️ A **physical Android device is required.** The app depends on Bluetooth Classic
> and native modules (Bare runtime, MMKV), which do **not** work on the Android
> emulator or in Expo Go.

**OBD-II adapter:**

- A standard **ELM327 Bluetooth** adapter (Bluetooth Classic, *not* BLE-only).
- Plug it into the car's OBD-II port (usually under the steering wheel).
- Pair it in Android **Settings → Bluetooth** first (typical PIN: `1234` or `0000`).

## Prerequisites (software)

- **Node.js 20+** and npm
- **JDK 17** and the **Android SDK** (Android Studio) with USB debugging set up
- An Android phone connected via USB with developer mode enabled

> Expo 56 pins exact native versions. Before changing native code, read the
> versioned docs at <https://docs.expo.dev/versions/v56.0.0/>.

## Setup & run (reproducible)

```bash
# 1. Clone
git clone https://github.com/gazzimon/OBDient.git
cd OBDient

# 2. Install dependencies
npm install

# 3. Configure environment (optional — only needed for online VIN decode)
cp .env.example .env
#   then edit .env and add your Vincario keys if you have them.
#   AI inference needs NO env vars — it runs on-device.

# 4. Connect a physical Android phone via USB (USB debugging ON), then:
npm run android
#   This builds a custom dev client with Gradle and installs it on the phone.
#   The first build takes several minutes.
```

Then, on the device:

1. Open OBDient → **Settings → QVAC Assistant → Load model**
   (downloads the model once; status turns to `READY`).
2. Plug the ELM327 into the car's OBD-II port and turn the ignition on.
3. Pair the adapter in Android Bluetooth settings (PIN `1234`).
4. In OBDient → **Settings → Scan Paired Devices** → tap your adapter to connect.
5. Go to **Dashboard / Diagnostics** to see live data and AI interpretations.

## Configuration (`.env`)

| Variable                          | Required | Purpose                              |
|-----------------------------------|----------|--------------------------------------|
| `EXPO_PUBLIC_VINCARIO_API_KEY`    | No       | Online VIN decode (Vincario API)     |
| `EXPO_PUBLIC_VINCARIO_SECRET_KEY` | No       | Online VIN decode (Vincario API)     |

There is **no** AI/model/base-URL variable: inference is on-device by design.

## Scripts

| Command              | Description                              |
|----------------------|------------------------------------------|
| `npm run android`    | Build + run the dev client on Android    |
| `npm start`          | Start the Metro bundler                  |
| `npm test`           | Run the Jest test suite                  |
| `npm run db:generate`| Generate Drizzle SQLite migrations       |
| `npm run db:studio`  | Open Drizzle Studio                      |

## Testing

```bash
npm test
```

Unit tests cover the OBD/DTC parsers, VIN mapping, the SHA-1 helper, and the
connect-to-vehicle use case (`src/__tests__/`).

## Hackathon compliance (QVAC requirements)

| Mandatory requirement                          | Status | Where                                            |
|------------------------------------------------|--------|--------------------------------------------------|
| All AI inference via QVAC SDK                   | ✅     | `src/data/datasources/qvac-sdk.datasource.ts`    |
| Runs on real consumer hardware (Mobile track)  | ✅     | Android phone + ELM327, this README              |
| Reproducibility + hardware setup instructions  | ✅     | This README                                      |
| RAG via QVAC SDK                                | 🚧     | In progress (QVAC embeddings over DTC/NHTSA data)|
| Complete artifacts (logs, demo, hardware proof)| 🚧     | See `/artifacts` (demo video, profiler logs)     |

## Roadmap (in progress for submission)

- **RAG** over a local DTC / NHTSA repair knowledge base using QVAC embeddings.
- **Tool calling & multi-agent orchestration**: expose OBD read, DTC lookup, NHTSA
  recall check and VIN decode as native QVAC tools.
- **QVAC Psy model** evaluation for the diagnostic reasoning step.
- **P2P delegated inference**: offload heavy report generation to a peer via QVAC's
  Holepunch-based delegated inference (and `pear://` model distribution).

## License

See [LICENSE](./LICENSE).
