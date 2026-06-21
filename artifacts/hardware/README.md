# Hardware proof & reproducibility

> 📄 [README](../../README.md) · 🎤 [Pitch](../../PITCH.md) · 🧠 [Vision](../../VISION.md) · **🔧 Reproducibility (you are here)**

OBDient runs on **real consumer hardware** (Mobile track requirement). The primary
proof is in the [demo video](../README.md#-demo-video), which shows the physical
phone pairing with the ELM327 adapter and pulling live data from the car.

Below are the exact specs of every device used, plus the full training setup, so the
results are reproducible.

---

## 1. Demo device — on-device inference

Runs the OBDient app and CARpsy on-device via the QVAC SDK.

| Spec | Detail |
|------|--------|
| Device | Motorola Edge 60 Fusion (Amazonite) |
| OS | Android 15 (minSdkVersion 29) |
| SoC | MediaTek Dimensity 7300 (4 nm) |
| CPU | Octa-core (4× Cortex-A78 @ 2.5 GHz + 4× Cortex-A55 @ 2.0 GHz) |
| GPU | Mali-G615 MC2 |
| RAM | 8 GB LPDDR4X |
| Storage | 256 GB UFS 2.2 (~1 GB free for on-device models) |
| Connectivity | Bluetooth Classic (SPP) |

> **On-device models (no GPU — run on the phone CPU via QVAC SDK):**
> CARpsy (Qwen3-0.6B Q4_K_M, ~400 MB RAM) + EmbeddingGemma 300M (4-bit, ~300 MB RAM).

> Bluetooth Classic and the QVAC Bare runtime do **not** work on the Android emulator
> or Expo Go — this can only run on a real phone.

---

## 2. OBD-II adapter

| Spec | Detail |
|------|--------|
| Adapter | ELM327 OBD2 multi-brand, Bluetooth Classic (Torque Pro compatible) |
| Chip | PIC18F25K80, firmware 1.5 |
| Protocol | SPP (Bluetooth Classic), PIN `1234` |
| Vehicle | Standard OBD-II port |

---

## 3. Training device — CARpsy fine-tune

| Spec | Detail |
|------|--------|
| Environment | Google Colab |
| GPU | NVIDIA **A100** (40 GB VRAM) |
| Precision | bf16 (A100) / fp16 fallback (T4) |
| Code & data | https://github.com/gazzimon/CARpsy |
| Weights | https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF |

**Method:** LoRA supervised fine-tuning (SFT) with **Unsloth**.
**Base model:** `unsloth/Qwen3-0.6B`, loaded in 4-bit (`load_in_4bit=True`).
**Output:** merged model (base + LoRA) exported to GGUF **Q4_K_M** →
`CARpsy-v2-qwen3-0.6b.Q4_K_M.gguf`, loaded in OBDient via the QVAC SDK.

**Dataset:** `canonical_dataset.jsonl` — 300 examples (20 DTC codes × 15 questions),
ChatML format (system / user / assistant), one fixed canonical answer per code in
BLUCKTEC format: `{CODE}: {SAE name}. Severity N/3 — {action}. Likely causes: …`.

### LoRA config

| Parameter | Value |
|---|---|
| Rank (r) | 16 |
| lora_alpha | 32 (2×r) |
| lora_dropout | 0.05 |
| target_modules | q_proj, k_proj, v_proj, o_proj |
| bias | none |
| Gradient checkpointing | unsloth |
| random_state | 42 |

### Training hyperparameters (SFTTrainer / TRL)

| Parameter | Value |
|---|---|
| Epochs | 100 |
| per_device_train_batch_size | 4 |
| gradient_accumulation_steps | 4 (effective batch 16) |
| Learning rate | 8e-5 |
| lr_scheduler_type | cosine |
| warmup_steps | 20 |
| weight_decay | 1e-2 |
| optim | adamw_8bit |
| Precision | bf16 (A100) / fp16 (T4) |
| max_seq_length | 512 |
| packing | True |
| seed | 42 |

**Validation:** 8 BLUCKTEC-format test cases; acceptance threshold ≥ 6/8 correct
(checks that the code, the Severity field, Likely causes, and fault keywords appear).
**Inference settings:** `temperature=0.1`, `top_p=0.9`; Qwen `<think>` blocks are
stripped from output.

---

## 4. How to run / reproduce

There are two ways to get OBDient onto a device. Both require a **physical Android
phone** — Bluetooth Classic and the QVAC Bare runtime do not work on the emulator or
Expo Go.

### Option A — Standalone APK (no dev environment needed)

A pre-built **release** APK (~486 MB — the QVAC on-device runtime ships native
libraries for every modality) is published on the project's GitHub Releases:
**https://github.com/gazzimon/OBDient/releases** . The JavaScript bundle is compiled
into the APK, so it runs **without Metro**.

> It's too large for the git repo (GitHub's 100 MB file limit), so it lives as a
> Release asset, not in this folder.

1. Download the APK from Releases, copy it to the phone, and install it (allow "install from unknown sources").
2. Open the app → **Settings → QVAC Assistant → Load model** (downloads CARpsy once, ~400 MB).
3. Pair the ELM327 in Android Bluetooth settings (PIN `1234`).
4. **Settings → Scan Paired Devices** → tap the adapter → open Dashboard / Diagnostics.

> The APK is signed with the standard Android **debug key** (the project ships no
> private release keystore), so Android may warn it's from an unidentified developer —
> expected for a hackathon artifact.

### Option B — Build from source (full reproduction)

This is how the app was developed and demoed. It produces a **development build**
(dev-client) that loads JS from the Metro bundler — it requires the Android SDK, a
USB-connected phone with USB debugging on, and Metro running.

```bash
git clone https://github.com/gazzimon/OBDient && cd OBDient
npm install
npm run android      # = expo run:android: compiles the dev-client, installs it, starts Metro
```

To rebuild the standalone release APK yourself:

```bash
cd android && ./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

### Models & repos

- **App:** https://github.com/gazzimon/OBDient
- **CARpsy training code & data:** https://github.com/gazzimon/CARpsy
- **CARpsy weights (GGUF):** https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF

---

## Stills

Add one or more frames from the demo video here as proof images, e.g.:

- `setup.jpg` — phone + ELM327 plugged into the car's OBD-II port.
- `dashboard.jpg` — live data streaming on the device.

_(Drop the image files in this folder and reference them above.)_
