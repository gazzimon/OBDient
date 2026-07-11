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
| **N3(a)** retorno senior | Diagnóstico senior gate-passed → `claudeKnowledge` (capa 0 + vector) → CARpsy lo reusa offline como *unverified*. Cierra el lazo en runtime | `container.ts` + `renderBriefRetrievalKey` + tests |
| **N4** auditoría | Ring buffer on-device + evento `gate` + panel dev en Settings (TTFT, tok/s, tasa del gate) — medible sin adb | `audit-log.ts`, `AuditPanel.tsx` + tests |
| **ADR-0010 F0** | Fix auditoría: 1 feed por peer + tope, dedup por id, cota de ingest | `remote-feed-manager.ts`, `collections.ts` + 12 tests |
| **C2** fedRAG en device | Datasource de conocimiento enrutado al worklet Bare por IPC (worklet compartido con harvest, `ns`); retirado el stub de Metro; handshake OBDIENT-RAG/1; espejo síncrono en RN + `_dispatch` intacto | `p2p-worklet.mjs`, `worklet-host.ts`, `hypercore-knowledge.datasource.ts` (ADR-0011) |
| **ADR-0010 F1** ingest continuo | Listener `append` por feed remoto en el worklet → los bloques que llegan en vivo se ingieren en la misma sesión | `p2p-worklet.mjs` `handleKnowledgePeer` + `scripts/knowledge-peer.mjs` |

> La auditoría SRE externa era mayormente ficción (describía un firmware ESP32 que no
> existe), pero verificarla destapó **defectos reales** de fiabilidad P2P, ya resueltos
> en la Fase 0. Los follow-ups genuinos quedan abajo (Fase B/C).

### Quality loop — verificación de integración (2026-07-10)

Primer test de extremo a extremo del pipeline de cosecha, device ↔ seed:

- ✅ **Contrato device↔seed blindado.** Nuevo `obdient-seed/test/conformance.test.mjs`
  reproduce la construcción exacta del `CaseChunk` del worklet y la pasa por el store
  real: el **id sobrevive el round-trip** `JSON.stringify→parse→stringify` de un brief
  anidado (el punto de falla silenciosa: un drift haría que el seed rechace todo por
  `idMismatch`). Enganchado al `npm test` del seed — cualquier drift futuro lo caza.
- ✅ **Transporte P2P + ingest + merge, probados sobre el DHT real** (contribuidor = el
  simulador de referencia): `feeds:1 · id-mismatch:0 · merged:1 → 1 record`. Contrato,
  replicación, merge por outcome y privacidad (`corrections.jsonl` sin VIN/MAC/identidad)
  confirmados en un run real, no en loopback.
- ⏳ **Pendiente: la pata de la app real.** El único feed cosechado hoy fue del simulador
  (evidencia: el `senior_answer` es el string hardcodeado del sim; el brief usa `.vehicle`
  en vez de `.identity`). Falta confirmar que la **app OBDient** — diagnóstico real → gate
  → outbox C1 → replicación — contribuye a un feed propio. Runbook: seed limpio +
  `Contribute cases` ON + un diagnóstico real con handoff senior gate-passed +
  `npm run harvest`; el record real llevará `brief.identity` y la respuesta real de Claude.

---

## 2. Trabajo abierto — fases ordenadas

### Fase A — Cerrar el lazo en runtime y hacerlo medible  *(mayor valor, riesgo bajo)*

- **N3(a) — Retorno del senior a CARpsy (reuso en runtime). ✅ HECHO (2026-07-10).**
  El lazo en runtime estaba abierto (`claudeKnowledge.store()` sin llamadores). Ahora,
  al cerrar un caso gate-passed, `KnowledgeReturnPort` guarda la respuesta del senior en
  `claudeKnowledge` (+ `ingestClaude`) con una clave de retrieval del caso
  (`renderBriefRetrievalKey`: vehículo + DTC/faultClass + síntomas, sin VIN). CARpsy la
  recupera **offline la próxima vez** como provenance *unverified*. Misma válvula de
  admisión que C1 (solo gate-passed); fire-and-forget. La mitad de *dataset* la cubre C1.
- **N4 — Superficie de auditoría (instrumentación). ✅ HECHO (2026-07-10).** El ring
  buffer en memoria (últimos 50, pub/sub) vive en `audit-log.ts` junto al JSONL de
  logcat; nuevo evento `gate` emitido desde `case-log.datasource` (el dominio queda
  puro). Panel dev en Settings (`AuditPanel.tsx`): TTFT/tok-s promedio, **tasa de pase
  del gate** (a/b), y las últimas líneas `[AUDIT]` — todo on-device, sin adb. Ya se
  puede medir la ganancia de N0 y la tasa del gate. Pendiente menor: badge de latencia
  por mensaje en el chat (requiere hilar `total_ms` hasta el resultado — follow-up).

### Fase B — Hacer real el fedRAG en device  ✅ HECHO (2026-07-11)

- **C2 — Puente IPC del worklet. ✅ HECHO.** `hypercore-knowledge.datasource.ts` ya no
  habla contra el stub no-op de Metro (retirado, junto a `stubs/`): es un cliente IPC del
  worklet Bare compartido (`worklet-host`, un solo runtime para harvest + conocimiento,
  multiplexado por `ns`). La replicación real corre en el worklet; el RN mantiene un
  **espejo en memoria** para que `getChunks`/`getPatterns` sigan síncronos, y `_dispatch`
  (trust + SHIMI + quorum) queda intacto en Hermes. Handshake OBDIENT-RAG/1 simétrico
  (corrige un bug latente: el feed remoto se abría sin la clave del peer). Detalle de
  diseño en **ADR-0011**.
- **ADR-0010 Fase 1 — Ingest continuo. ✅ HECHO (emparejado con C2).** El worklet registra
  `remoteFeed.on('append', …)` por feed remoto, así que los bloques que llegan por
  replicación en vivo se ingieren y se empujan al espejo en la misma sesión. Verificable
  con `scripts/knowledge-peer.mjs` (Enter → append en caliente).

> **Pendiente de verificación on-device** (no bloquea el merge de código): correr el
> runbook con `scripts/knowledge-peer.mjs` sobre dos peers reales y confirmar peers ≥1,
> replicación saliente y el bite de F1. El único test que falla en CI es el de integración
> que exige un Ollama local (`stack-integration.test.ts`) — independiente de esta pista.

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

Con las **Fases A y B cerradas** (N3a + N4; C2 + ADR-0010 F1), el fedRAG ya corre real en
device sobre el worklet Bare compartido. El siguiente bloque es la **Fase C**: endurecer el
camino de hardware (**ADR-0010 F3** — timeout/retry serial de ELM327 bajo carga) y verificar
el bootstrap del seed (**ADR-0010 F2**). Queda como cola de la Fase B la **verificación
on-device** del runbook (dos peers reales) — código listo, falta correrlo en el teléfono.
