# OBDient — Roadmap de ejecución (snapshot 2026-07-10)

Vista consolidada del trabajo **abierto**, ordenada por valor y dependencia. Es un
snapshot de estado: nace porque el trabajo pendiente quedó disperso entre PLAN-002 v2
(pistas N/C), ADR-0010 (follow-ups de la auditoría) y las pistas congeladas.

- **Estrategia** (por qué): [ROADMAP.md](ROADMAP.md) — el lazo de aprendizaje y las tres asíntotas.
- **Diseño de la pista de calidad/cosecha** (cómo): [ADR/PLAN-002-field-validation-gate.md](ADR/PLAN-002-field-validation-gate.md).
- **Fiabilidad P2P** (auditoría): [ADR/0010-resiliencia-p2p.md](ADR/0010-resiliencia-p2p.md).
- **Hub central** (seed C / proxy D): repo `gazzimon/obdient-seed` → `PROTOCOL.md`.

---

## 1. Estado actual — mergeado y verificado

| Hito | Qué hace | Evidencia |
|------|----------|-----------|
| **N0** no-think | Apaga los `<think>` de Qwen3 (latencia/batería) | `qvac-sdk.datasource.ts` |
| **N1** gate | `runGate(text, ctx)` puro anti-alucinación (G1/G2/G3/G5) | `diagnostic-gate.ts` + 19 tests |
| **N2** gate cableado | Diagnóstico junior y senior gateados pre-UI/pre-persist; verdict en `conversation_turns.gate_json`; badge UX1 | intake-session + `ChatBubble` |
| **C0** spike P2P | Hypercore+Hyperswarm corren en el worklet Bare (validado en device) | `p2p/harvest-worklet.mjs` + Settings |
| **C1** cosecha | Caso gate-passed → `CaseChunk` al feed local (outbox); enriquecimiento por outcome (mismo id → merge); toggle `contributeCases` | `harvest-outbox.datasource.ts` + válvula de admisión |
| **C3/C4** seed | Seed peer Node en repo propio; topic de cosecha separado del de conocimiento | `gazzimon/obdient-seed` |
| **ADR-0010 F0** | Fix auditoría: 1 feed por peer + tope, dedup por id, cota de ingest | `remote-feed-manager.ts`, `collections.ts` + 12 tests |

> La auditoría SRE externa era mayormente ficción (describía un firmware ESP32 que no
> existe), pero verificarla destapó **defectos reales** de fiabilidad P2P, ya resueltos
> en la Fase 0. Los follow-ups genuinos quedan abajo (Fase B/C).

---

## 2. Trabajo abierto — fases ordenadas

### Fase A — Cerrar el lazo en runtime y hacerlo medible  *(mayor valor, riesgo bajo)*

- **N3(a) — Retorno del senior a CARpsy (reuso en runtime).** Hoy el lazo está
  **abierto en runtime**: `claudeKnowledge.store()` no lo llama nadie (verificado). La
  mitad de *dataset* ya la cubre C1 (cosecha → seed → `corrections.jsonl`); falta la
  mitad de *reuso inmediato*: al cerrar un caso gate-passed, guardar la respuesta del
  senior en `claudeKnowledge` (+ `ingestClaude`) para que CARpsy la recupere **offline
  la próxima vez**, como provenance *unverified*. Es el mecanismo "se vuelve más
  inteligente" en caliente. Riesgo BAJO. Reusa la capa 0 que ya existe.
- **N4 — Superficie de auditoría (instrumentación).** Ring buffer en memoria
  alimentado por `audit()` + panel dev en Settings (TTFT, tok/s, tokens, verdicts del
  gate) + badge "on-device · N s" para el usuario. Sin esto **no podemos medir** ni la
  ganancia de N0, ni la tasa de rechazo del gate, ni la métrica de dependencia
  (ROADMAP Step 6). Barato, alto apalancamiento para la demo. Riesgo BAJO.

### Fase B — Hacer real el fedRAG en device  *(desbloquea el sustrato ya probado en C0)*

- **C2 — Puente IPC del worklet (retirar el stub de Metro).**
  `hypercore-knowledge.datasource.ts` habla hoy contra el stub no-op de
  `metro.config.js` (Hermes no tiene Node). C0 probó que el worklet Bare corre el stack
  real; C2 enruta el datasource al worklet por IPC (reusando el patrón de
  `harvest-outbox`). Habilita compartir/recibir conocimiento P2P en el teléfono, no solo
  cosechar. Riesgo MED (plomería sobre sustrato probado).
- **ADR-0010 Fase 1 — Ingest continuo de feeds remotos.** Bug preexistente: `_loadFeed`
  corre una sola vez al abrir el feed remoto y **no hay listener de `append`**, así que
  los bloques que llegan por replicación tras la apertura no se ingieren. Solo *muerde*
  cuando los feeds fluyen en vivo — es decir, exactamente cuando aterriza C2. **Emparejar
  con C2.** Riesgo MED.

### Fase C — Endurecer e instrumentar  *(follow-ups de fiabilidad)*

- **ADR-0010 Fase 3 — Timeout/retry serial de ELM327 bajo carga.** Revisar la política
  del camino de lectura de hardware; es la ruta que más incide en la experiencia real de
  diagnóstico. Riesgo MED.
- **ADR-0010 Fase 2 — Verificar bootstrap del seed (ADR-0003).** Confirmar estado real
  de ancla de confianza / snapshot bundleado / pinning node vs. lo cableado. Riesgo BAJO
  (auditoría, no código nuevo necesariamente).

### Fase D — Diferido  *(gated en corpus o en decisión de producto)*

- **N5 — Destilación batch (ADR-0002 Fase 4).** `corrections.jsonl` → fine-tune central
  → gate `eval-carpsy.js` (≥80%, TC-04) → GGUF nuevo. Es lo único que sube el **techo de
  razonamiento**. No se agenda hasta que C1+C3 acumulen un corpus real. Central/batch,
  nunca on-device.
- **M6/M7 — Hardware readiness / freeze frame (ADR-0008).** Detrás de feature flag;
  G7/G8 inertes hasta entonces; Mode 06 fuera. Riesgo ALTO (compatibilidad ELM327),
  aislado.
- **Opción D — Proxy del senior.** Fase 2 de la cosecha; solo con modelo
  subsidiado/B2B (BYOK ya resolvió la seguridad de la clave). Enchufa al mismo store del
  hub.

---

## 3. Congelado (no se implementa en este roadmap)

ADR-0002 (curaduría central — se activa con N5), ADR-0004/0005 (Beta-Binomial + memoria
episódica — dependen de tráfico/corpus), ADR-0007 (firma/rotación). El puente que los va
alimentando ya corre: UX4 (outcome) + C1 (cosecha).

---

## 4. Secuencia recomendada

**A → B → C → D.** En una línea: **cerrar el lazo en runtime (N3a) y medirlo (N4)** →
**hacer real el fedRAG en device (C2 + ADR-0010 F1, emparejados)** → **endurecer el camino
de hardware (F3) y verificar el bootstrap (F2)** → **destilar cuando haya corpus (N5)** y
hardware/proxy detrás de flags.

El siguiente paso natural, y de mayor ROI, es **N3(a)**: es barato, cierra el único lazo
que sigue abierto, y reusa la capa 0 que ya está construida.
