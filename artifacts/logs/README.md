# Runtime logs — on-device QVAC inference & RAG

These logs are the proof that OBDient runs **all primary AI inference and the full
RAG pipeline on the device itself**, through the QVAC SDK — no inference server, no
cloud on the diagnostic path.

## What the evidence looks like

Each diagnostic session produces lines like these (tags are emitted by the app code):

| Tag | Emitted by | Proves |
|-----|-----------|--------|
| `[QVAC] Model loaded on-device …` | `qvac-sdk.datasource.ts` | CARpsy GGUF loaded into device RAM via QVAC SDK |
| `[QVAC] On-device inference: N tokens in …ms` | `qvac-sdk.datasource.ts` | Generation ran locally + throughput |
| `[RAG] retrieval (dtc=…): claude/shimi/vector …` | `shimi.datasource.ts` | 4-layer on-device RAG executed |
| `[QualityEval] Score x/5 …` | `multi-agent-chat.ts` | Multi-agent quality loop ran |
| `[ELM327] << RESPONSE …` | `elm327.datasource.ts` | Live OBD-II data over Bluetooth |

## How to reproduce the capture

1. Connect the phone via USB (USB debugging ON) and run the app: `npm run android`.
2. From the repo root, start the capture script (clears the buffer, then records):

   **Windows (PowerShell):**
   ```powershell
   ./scripts/capture-logs.ps1
   ```
   **macOS / Linux:**
   ```bash
   ./scripts/capture-logs.sh
   ```

3. In the app, run a full session: **load CARpsy → connect the ELM327 → read DTCs →
   ask the assistant a diagnostic question**.
4. Stop the capture (`Ctrl+C`). The session is saved here as
   `session-<timestamp>.log`.

> The scripts capture the `ReactNativeJS` logcat tag (where `console.log` lands on
> Android) plus QVAC SDK native tags, so both the JS-side evidence and the native
> SDK activity are recorded.

## Files

- `session-<timestamp>.log` — the captured session (commit at least one real run here).
