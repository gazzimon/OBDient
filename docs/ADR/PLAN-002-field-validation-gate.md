# PLAN-002 v2: The return path — deterministic gate + senior distillation

- **Status:** Active roadmap (v2, rewritten 2026-07-10). v1 (2026-06-26) is
  preserved in git history as `002.txt` @ `6d40112`; its §7 ComputerPool analysis
  and original milestone bodies live there.
- **Author:** architecture
- **Builds on:** PLAN-001 (gate pattern — re-scoped here), ADR-0002 (senior
  curation & batch distillation — becomes the FT strategy), ADR-0009 (admission →
  senior handoff — the pivot that triggered this rewrite), ADR-0006 (deterministic
  injectable core).
- **Related:** ADR-0004/0005 (still frozen post-MVP), ADR-0008 (hardware, still
  feature-flagged, unchanged).

================================================================================
## 0. WHY THE REWRITE — verified code facts (2026-07-10)
================================================================================

v1 assumed the diagnostic answer came from the on-device 0.6B and had to be
disciplined via strict JSON (M2) + gate + bounded retry (M3). Two things changed:

1. **The architecture pivoted (ADR-0009, built).** CARpsy now does a deterministic
   intake → structured brief (`brief-assembler.ts`, pure logic — M0/M1 are its
   consumers) → opt-in handoff to a capable senior (Claude Sonnet 5) that conducts
   the diagnosis. Forcing JSON out of the small model and retrying it is no longer
   the path the product takes.
2. **The learning loop is disconnected.** Verified in code: `claudeKnowledge.store()`
   has **no callers**; the per-turn background quality eval was removed
   (`multi-agent-chat.ts` is now a thin junior-only pipeline); the senior's
   conversations persist to the case base (`briefs`, `conversation_turns`,
   `outcomes`) but **never come back to CARpsy** — not as retrieval, not as weights.
   The senior teaches the user; the system learns nothing.

**Editor decisions (2026-07-09/10, binding):**
- No passive DTC-recurrence detection; no confidence-gated promotion (old Step 5).
- Do NOT depend on the user's 👍/👎 as the admission signal (keep the control, but
  the pipeline must work if nobody ever taps it).
- No runtime server, ever. Central pieces are build-time only (ADR-0002 contract).
- UX4 outcome capture (built) stays — implicit signal, zero friction.

================================================================================
## 1. NORTH STAR
================================================================================

**Every senior answer must (a) be validated against the real vehicle before it is
trusted, and (b) come back to CARpsy — as retrieval now, as weights later.**

One piece serves three jobs — the **deterministic gate**:
1. **Runtime anti-hallucination** (junior & senior output vs the car's real data).
2. **Admission valve for the distillation dataset** (replaces the human thumb:
   tier-trust teacher→student + deterministic grounding + build-time curation).
3. **Measurable evidence** (gate results are auditable records).

Gate-as-**filter**, not gate-as-retry: a failing answer is *marked unconfirmed*
(honest fallback), never regenerated in a loop on-device.

================================================================================
## 2. MILESTONES (ordered; each ships alone)
================================================================================

- **N0 — No-think mode. [speed, trivial]** Qwen3 emits `<think>…</think>` blocks
  that `stripThinkingTokens()` discards — pure latency/battery waste. Append the
  Qwen3 soft switch `/no_think` to the system prompt (gated on the loaded model
  being Qwen; the Llama fallback is left untouched). Measure before/after with the
  existing `[AUDIT]` records (`completion_tokens`, `ttft_ms`, `total_ms`).
  Files: `qvac-sdk.datasource.ts`. Risk LOW.
- **N1 — Deterministic gate over free prose.** `src/domain/services/diagnostic-gate.ts`
  — pure `runGate(text, ctx)` where ctx = active DTCs + `VehicleState` (M1).
  Extraction by regex/keyword table; **no structured output required** (v1's M2
  is dropped — see §4). Rules in §3. Table tests. Risk LOW.
- **N2 — Wire the gate.**
  (a) Junior path: `interpret()` / diagnostic chat replies pass through the gate
  before UI; hard violations render the answer as *unconfirmed* + the violated
  facts (UX1 of v1, kept). No retry.
  (b) Senior path: the senior's diagnosis is gated before persisting to the case
  base; the gate verdict is stored with the turn. Risk LOW-MED.
- **N3 — Senior return path (repair the loop).** Two halves, same source:
  (a) **Runtime reuse. ✅ BUILT (2026-07-10).** A gate-passed senior answer →
  `claudeKnowledge.store()` (revives Layer 0 + `ingestClaude` vector index) via
  `KnowledgeReturnPort`, keyed by `renderBriefRetrievalKey(brief)` → CARpsy
  retrieves it offline next time as *unverified* provenance (the prompt split
  already exists). Same admission valve as C1 (gate-passed only); fire-and-forget.
  (b) **Distillation harvest. ✅ BUILT** as the C-track (C1 outbox → C3 seed →
  `corrections.jsonl`), superseding the manual-export sketch here.
  Risk MED. **Done.**
- **N4 — Audit surface.** Ring buffer (~50 records) fed by `audit()` alongside
  console; dev-only panel in Settings (TTFT, tok/s, tokens, gate verdicts); a
  minimal user-facing "on-device · N s" badge (UX3 of v1 becomes the gate/latency
  badge). Risk LOW.
- **N5 — Batch distillation (deferred until corpus exists).** ADR-0002 Phase 4:
  `corrections.jsonl` → central fine-tune → `eval-carpsy.js` gate (≥80%, TC-04
  no-hallucination) → GGUF release. The senior's role becomes *data factory for
  the next CARpsy*. Not scheduled until N3 has accumulated real cases.

Hardware (readiness Mode 01 PID 01 / freeze frame Mode 02) stays exactly as v1
left it: feature-flagged milestones per ADR-0008, G7/G8 inert, Mode 06 out.

================================================================================
## 3. GATE RULES (re-scoped from PLAN-001 §2 — free prose, no JSON)
================================================================================

Each rule is pure: `(text, ctx) → violations`. **Hard** violations ⇒ answer marked
unconfirmed; **soft** ⇒ annotation only. Bias: generous coherence sets, few false
accusations — an anti-hallucination gate must itself not hallucinate violations.

Committed now:
- **G2 (hard) — Cited DTCs exist.** Every DTC-shaped token in the text must be an
  active code. The highest-value anti-hallucination check; regex, unambiguous.
- **G1 (hard) — Fault-domain coherence.** Deterministic keyword table (es/en) maps
  prose mentions ("catalizador", "fuel injector"…) to SKOS concepts; each mentioned
  concept must belong to the coherence set of some active DTC
  (`faultClassClosure(dtc)` ∪ canonical concept's `related` — the ontology's
  related edges do real work: "injector" is coherent with P0302 via
  `misfire_cylinder.related`). Inert when there are no DTCs or any active DTC is
  unmapped (graceful degradation — never accuse from ignorance).
- **G5 (hard) — Engine-state coherence.** "Won't start / no arranca" claims vs
  `engineState === 'running'` (only fires on real RPM evidence; `unknown` is inert).
- **G3 (soft) — Urgency coherence.** "Do not drive / no conduzca" style claims when
  aggregate DTC severity is info/none AND no critical live alert.

Later (need careful keyword design or hardware):
- **G4** live-alert coherence (PID claims in prose are false-positive-prone; design
  the keyword→PID table with real transcripts first).
- **G7/G8** readiness / freeze frame — behind ADR-0008 flags, unchanged.
- v1's **G6** (confidence floor) died with structured output — nothing to read a
  confidence from; the tiered trust model of §5 replaces it.

================================================================================
## 4. DROPPED FROM v1 (with reasons — do not resurrect silently)
================================================================================

- **M2 strict JSON (`DiagnosticHypothesis` + `proposeStructured`).** The only HIGH
  risk of v1, and its premise (0.6B emits the final answer) no longer holds.
  Regex extraction + deterministically injected facts give ~80% of the value.
- **M3 retry loop (`MAX_RETRIES=2`).** Retrying the local model burns battery to
  improve the wrong agent; the senior handoff is the escalation path now.
- **M4 Generator/Advisor role split.** Partially superseded: the interviewer
  already passes its own per-role system prompt through `chat()`.
- **Passive DTC recurrence + Step-5 promotion.** Editor decision; the signal is
  ambiguous (manual clears, intermittent faults). UX4 capture stays.
- **Per-turn background quality eval.** Removed from the code for good reasons
  (tokens on greetings, invisible audits). The opt-in senior handoff is the better
  design; do not bring the old eval back.
- **ComputerPool (v1 §7).** Frozen, unchanged: privacy blocker (live-query
  federation was explicitly rejected by ADR-0003) must be resolved first. Full
  analysis in v1 (git history).

================================================================================
## 5. HARVEST & DISTILLATION STRATEGY (design Q&A, 2026-07-10)
================================================================================

**No runtime server.** The only central piece is a build-time publisher/harvester
(ADR-0002). Never "all conversations": only anonymized, gate-passed case pairs;
filtered at the edge; no VIN / BT address / identity (same contract as
ADR-0002/0003).

**Transport decision (2026-07-10): P2P seed peer (option C) now; senior proxy
(option D) as phase 2, only after C is built.** Rationale — the repo is closer to
C than documented: `react-native-bare-kit` + `bare-pack` are already dependencies
(the QVAC worker runs on a Bare worklet), `hypercore`/`hyperswarm` are real deps,
and the "stub" is only a Metro resolver redirect because **Hermes** lacks Node
built-ins — exactly what the Bare worklet provides. The datasource
(`hypercore-knowledge.datasource.ts`) is complete; it lacks a runtime, not code.
Option D (a proxy in front of the senior) is deferred: BYOK already solved key
security (audit C1), so D only makes sense with a subsidized/B2B product model.

**C-track milestones (harvest transport):**
- **C0 — Spike: Hypercore inside the Bare worklet. ✅ PASSED ON-DEVICE
  (2026-07-10, Motorola edge 60 fusion / Android 16).** A minimal second worklet
  (own bundle via `bare-pack`, launched with `react-native-bare-kit`) that opens
  a Hypercore, appends a block, reads it back, reports over IPC. THE technical
  risk of the whole track — native addons (udx/sodium/rocksdb) inside bare-kit
  on Android — is retired: `worklet boot: OK · hypercore: OK (1-block roundtrip)
  · hyperswarm: OK`. Two blockers were found and fixed on the way:
  (1) the manifest-aware `link.mjs` resolves addons from the node_modules ROOT
  and silently skips nested packages (`bare-dns`, `sodium-native`, `udx-native`,
  `rocksdb-native`…) — they are now pinned as root devDependencies so
  `bare-link` finds them and the APK links their `.so`s. The same gap made the
  QVAC worker abort the entire app at startup (`ADDON_NOT_FOUND:
  libbare-dns.2.1.4.so` → unhandled rejection → SIGABRT), which presented as a
  "silent" crash because `capture-crash.ps1` filtered out the `bare` logcat tag
  (also fixed). After any `npm install` that moves bare-* packages, verify
  `react-native-bare-kit/android/src/main/addons/` still contains the
  manifest's addons before trusting an existing APK.
  (2) `Worklet.IPC.write()` hands `data.buffer/byteOffset/byteLength` straight
  to the native module, so writes MUST be TypedArrays — plain strings throw
  "Value is undefined, expected an Object" asynchronously inside streamx and
  the command never reaches the worklet (`stringToBytes` added in
  `p2p-spike.ts`). Everything else is plumbing.
- **C1 — `CaseChunk` + local feed as outbox. ✅ BUILT (2026-07-10).** The
  harvest worklet (`p2p/harvest-worklet.mjs`) owns the device's persistent
  append-only feed (the feed IS the outbox — store-and-forward is Hypercore's)
  and computes the content id (`sha256(JSON.stringify(brief)+seniorAnswer)` via
  `bare-crypto` — the hub re-checks the same recipe). RN side:
  `harvest-outbox.datasource.ts` (worklet lifecycle + IPC, fire-and-forget).
  **Admission valve:** only a GATE-PASSED senior diagnosis is contributed
  (`diagnostic-intake-session.ts` → `HarvestPort`, wired in `container.ts`);
  junior diagnoses never distill. **Outcome enrichment:** `saveOutcome`
  re-appends the same case with the UX4 outcome — same id, the hub merges.
  Consent: a dedicated `contributeCases` toggle (default OFF, separate from
  Distributed RAG), checked at contribution time. Brief redacted by
  construction. Tests: admission valve (pass→1 case, fail→0, junior→0) + the
  seed's ingest/merge suite already covers the hub side.
- **C2 — Worklet IPC bridge.** `hypercore-knowledge.datasource.ts` talks to the
  worklet over RPC instead of importing hypercore directly (Metro stub path
  retired); graceful degradation preserved (worklet dead → today's behavior).
- **C3 — Seed peer. ✅ BUILT (2026-07-10) — extracted to its own repo:
  `gazzimon/obdient-seed` (private).** Plain Node, runs on a PC/VPS. Joins the
  harvest topic, replicates contributor feeds read-only, persists, exports
  deduped `corrections.jsonl` (ADR-0002 F1 format). Self-test 13/13 (wire
  preamble incl. TCP coalescing, replication, ingest policy). The wire & data
  contract lives in that repo's `PROTOCOL.md` (source of truth; the app's
  `distributed-chunk.ts` mirrors it).
  **D-ready ingest (decided 2026-07-10):** transport and ingestion are split —
  `src/seed/` (P2P transport, phase C) vs `src/ingest/store.mjs`
  (transport-agnostic case store) — so the phase-D proxy plugs into the SAME
  store as a second transport. The store MERGES by content-addressed id
  (outcome is not hashed): the proxy captures brief+answer at senior-call time
  (outcome null), the UX4 outcome arrives days later offline via C and
  enriches the same record. Non-null outcome wins; ties → newest `createdAt`.
- **C4 — Topic separation.** Case harvest uses its own DHT topic
  (`obdient-harvest-v1`), separate from the knowledge-sharing topic
  (`obdient-rag-v1`): peers don't need each other's raw cases (knowledge flows
  down via the curated bundle, ADR-0002) — data minimization by construction.
- **D (phase 2, after C ships).** Senior proxy: harvest + senior call share one
  gateway; unlocks subsidized/B2B billing. Not before C works end-to-end.

**Trust basis without user thumbs.** The senior→junior direction is standard
teacher→student distillation — NOT the Claude-validates-Claude closed loop (that
trap is same-tier self-validation). Admission = tier trust + **gate pass**
(structurally grounded in the car's real data) + provenance (senior leaned on
verified KB) + batch TC-04 check + **your build-time curation** before any
`knowledgeVersion` bump. User thumbs and UX4 outcomes remain as *extra* signals,
never as the bottleneck.

**Training pair:** `brief (deterministic facts) → gate-passed senior answer`.
FT teaches **reasoning/format, not facts** — facts stay in retrieval. Never
train on the junior's own output (model collapse).

================================================================================
## 6. SPEED TRACK (local model)
================================================================================

1. **N0 no-think** — the big lever (thinking tokens are generated then discarded).
2. Role-sized models: intake doesn't need 1.7B; keep the big one for narration.
3. Prompt shrinking: shorter system prompt, tighter RAG snippets, structured fact
   lines instead of prose. TTFT scales with prompt tokens.
4. Verify GPU/NNAPI offload in the SDK (`n_gpu_layers`); CPU-only is the slow path.
5. KV/prefix reuse across turns if the SDK exposes it (system+context re-encodes
   every turn today).

================================================================================
## 7. UI/UX DELTAS (from v1 §5)
================================================================================

- **UX0 hypothesis card** → simplified: answer + gate badge (passed / unconfirmed)
  + violated-facts list when unconfirmed. No confidence meter (no confidence field).
- **UX1 honest unconfirmed state** → kept as-is (now driven by gate verdict).
- **UX2 provenance distinction** → kept (verified vs unverified split exists).
- **UX3 loop transparency** → becomes the on-device/latency/gate badge (N4).
- **UX4 outcome capture** → ✅ built (tap-only pills in `reports.tsx`); unchanged.

================================================================================
## 8. VERIFICATION
================================================================================

- **N0:** compare `[AUDIT]` inference records before/after on the same prompts —
  `completion_tokens` should drop sharply; `total_ms` with it. No `<think>` residue
  in UI (strip stays as defense).
- **N1:** table tests in `src/__tests__/diagnostic-gate.test.ts` — every rule with
  pass/violation/inert cases (invented DTC ⇒ G2; catalyst-with-P0171 ⇒ G1;
  injector-with-P0302 ⇒ pass via related; unmapped DTC ⇒ G1 inert; no-start vs
  running ⇒ G5; urgent tone on info DTCs ⇒ G3 soft).
- **N2:** on-device walkthrough — unconfirmed marking renders, never a dead end;
  senior turn persists with gate verdict attached.
- **N3:** offline next-session retrieval of a stored senior answer (unverified
  section of the prompt); `corrections.jsonl` export opens and validates.
- **N4:** dev panel shows records matching logcat `[AUDIT]` lines.
