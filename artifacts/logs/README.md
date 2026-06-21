# Runtime logs — on-device QVAC inference & RAG

These logs are the proof that OBDient runs **all primary AI inference and the full
RAG pipeline on the device itself**, through the QVAC SDK — no inference server, no
cloud on the diagnostic path.

## The captured session

[`session-20260621-124953.log`](session-20260621-124953.log) — a full run on the
real phone (Motorola Edge 60 Fusion) with the ELM327 adapter connected to a live
vehicle. It contains the complete multi-agent chain firing four times in a row:
**ELM327 live data → on-device RAG retrieval → on-device CARpsy inference →
quality evaluation.**

## What the evidence looks like

Each diagnostic session produces lines like these (tags are emitted by the app code).
The excerpts below are **real lines from the captured session**:

| Tag | Emitted by | Proves | Real line from the capture |
|-----|-----------|--------|----------------------------|
| `[QVAC] Model loaded on-device …` | `qvac-sdk.datasource.ts` | CARpsy GGUF loaded into device RAM via QVAC SDK | `[QVAC] Model loaded on-device in 9429ms — src=…CARpsy-v2-qwen3-0.6b.Q4_K_M.gguf modelId=ffe5e08fe94ddb38` |
| `[QVAC] On-device inference: N tokens in …ms` | `qvac-sdk.datasource.ts` | Generation ran locally + throughput | `[QVAC] On-device inference: 78 tokens in 41026ms (1.9 tok/s) modelId=ffe5e08fe94ddb38` |
| `[RAG] retrieval (dtc=…): …` | `shimi.datasource.ts` | 4-layer on-device RAG executed | `[RAG] retrieval (dtc=none): shimi=0 vector=3 → verified=3 unverified=2` |
| `[QualityEval] Score x/5 …` | `multi-agent-chat.ts` | Multi-agent quality loop ran | `[QualityEval] Score 3/5 — response acceptable` |
| `[ELM327] << RESPONSE …` | `elm327.datasource.ts` | Live OBD-II data over Bluetooth | `[ELM327] << RESPONSE "010C": "41 0C 0E CE"` (RPM) · `"ATRV": "14.2V"` (battery) |

> **Why it's the diagnostic path, not the cloud:** the four `[QVAC] On-device
> inference` lines are each preceded by a `[RAG] retrieval` line and followed by a
> `[QualityEval]` line — the whole reasoning chain runs on the phone. Cloud (Claude)
> is only ever reached for the opt-in *general* questions, which is a separate path.

## How to reproduce the capture

1. Connect the phone via USB (USB debugging ON) and run the app: `npm run android`
   (target the **physical device** — Bluetooth Classic and the QVAC Bare runtime do
   not work on the emulator).
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

## Structured audit log (`audit-*.jsonl`)

Alongside the human-readable `[QVAC]` lines, the app emits a **machine-parseable
audit record** for every model lifecycle and inference event, tagged `[AUDIT]`
(see [`src/core/utils/audit-log.ts`](../../src/core/utils/audit-log.ts)). One JSON
object per line:

```jsonc
{"ts":"…","event":"model_load","modelId":"…","src":"…CARpsy…Q4_K_M.gguf","load_ms":9429}
{"ts":"…","event":"inference","modelId":"…","prompt_chars":2317,"prompt_tokens_est":580,
 "completion_tokens":78,"ttft_ms":1840,"total_ms":41026,"tokens_per_sec":1.9}
{"ts":"…","event":"model_unload","modelId":"…"}
```

| Field | Meaning |
|-------|---------|
| `event` | `model_load` · `model_unload` · `inference` |
| `load_ms` | model load time (load events) |
| `prompt_chars` / `prompt_tokens_est` | prompt size (tokens ≈ chars/4 — the SDK exposes no tokenizer to JS) |
| `completion_tokens` | tokens generated |
| `ttft_ms` | **time-to-first-token** |
| `total_ms` / `tokens_per_sec` | full latency + throughput |

The `[AUDIT]` lines ride the same `ReactNativeJS` logcat tag, so the normal capture
already records them. To pull a clean `.jsonl` out of a captured session:

```powershell
./scripts/extract-audit.ps1            # newest session-*.log → artifacts/logs/audit-<stamp>.jsonl
```
```bash
./scripts/extract-audit.sh             # macOS / Linux
```

> The committed `session-…124953.log` predates the audit instrumentation, so it has
> no `[AUDIT]` lines — capture one fresh session on the audit build to produce an
> `audit-*.jsonl`.

## Verify it yourself

After capturing (or against the committed log), confirm the on-device inference line
is present:

```powershell
Select-String -Path artifacts/logs/session-*.log -Pattern "On-device inference:"
```

## Files

- [`session-20260621-124953.log`](session-20260621-124953.log) — the captured
  session (4× on-device inference + RAG + quality eval, no context overflow).
