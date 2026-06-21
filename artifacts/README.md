# OBDient — Submission Artifacts

Evidence package for the **Tether QVAC Hackathon — Mobile track**. This folder
maps 1:1 to the mandatory *"Submit complete artifacts (logs, demo video, hardware
proof, etc.)"* requirement.

| Mandatory artifact | Evidence | Location |
|---|---|---|
| 🎥 **Demo video** | End-to-end walkthrough of the app on a real phone | [YouTube](https://youtu.be/AU2e477oyn0) |
| 🔌 **Hardware proof** | Physical phone + ELM327 connecting to a real car | In the demo video (see timestamp below) + [hardware/](hardware/) |
| 📋 **Logs** | Runtime logs proving on-device QVAC inference + RAG | [logs/](logs/) |
| 📦 **Reproducibility** | Full setup & run instructions | [../README.md](../README.md) |
| 🧠 **Trained model** | CARpsy fine-tune (code + weights) | [github.com/gazzimon/CARpsy](https://github.com/gazzimon/CARpsy) · [HuggingFace](https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF) |

---

## 🎥 Demo video

**Watch:** https://youtu.be/AU2e477oyn0

Suggested chapter markers (fill in with real timestamps):

| Time | What it shows |
|------|---------------|
| `0:00` | App launch, dashboard |
| `0:00` | **Hardware proof** — ELM327 plugged into the car, phone pairing over Bluetooth |
| `0:00` | Live OBD-II data streaming (20 PIDs) |
| `0:00` | On-device AI diagnosis with CARpsy (offline) |
| `0:00` | Multi-agent chat + human 👍/👎 feedback |

---

## 🔌 Hardware proof

The demo video shows the real hardware in use (phone + ELM327 adapter connecting to
the vehicle's OBD-II port). A still frame is saved in [hardware/](hardware/) for
quick reference.

- **Device:** physical Android phone (Android 10+, Bluetooth Classic)
- **Adapter:** ELM327 Bluetooth Classic (chip PIC18F25K80, firmware 1.5, SPP)
- **Why it matters:** the Mobile track requires running on real consumer hardware —
  Bluetooth Classic and the QVAC Bare runtime do **not** work on emulators.

---

## 📋 Logs

[logs/](logs/) contains a captured runtime session that proves **all primary AI
inference and RAG run on-device via the QVAC SDK** — no inference server, no cloud
for the diagnostic path. See [logs/README.md](logs/README.md) for how the capture
was produced and how to reproduce it.

Key evidence lines (real lines from [`logs/session-20260621-124953.log`](logs/session-20260621-124953.log)):

```
[QVAC] Model loaded on-device in 9429ms — src=…CARpsy-v2-qwen3-0.6b.Q4_K_M.gguf modelId=ffe5e08fe94ddb38
[QVAC] On-device inference: 78 tokens in 41026ms (1.9 tok/s) modelId=ffe5e08fe94ddb38
[RAG]  retrieval (dtc=none): shimi=0 vector=3 → verified=3 unverified=2
[QualityEval] Score 3/5 — response acceptable
```

---

## ✅ QVAC mandatory-requirements checklist

- [x] All primary AI inference via QVAC SDK — see `logs/` (`[QVAC]` lines)
- [x] RAG via QVAC SDK — see `logs/` (`[RAG]` lines)
- [x] Mobile track hardware constraints — physical phone + ELM327 (video + `hardware/`)
- [x] Full reproducibility + hardware setup — [../README.md](../README.md)
- [x] Complete artifacts submitted — this folder
