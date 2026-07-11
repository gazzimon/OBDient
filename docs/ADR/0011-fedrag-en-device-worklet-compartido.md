# ADR-0011: fedRAG real en device — worklet Bare compartido e IPC por namespace

- **Estado:** Aceptado
- **Fecha:** 2026-07-11
- **Deciders:** Gustavo (gazzimon)
- **Relacionados:** ADR-0006 (núcleo determinístico inyectable — el datasource
  sigue siendo un puerto), ADR-0010 (resiliencia P2P — su Fase 1 se cierra aquí),
  ADR-0003 (malla social / seed), PLAN-002 v2 (pistas C0/C1/C2).
- **Repos afectados:** `gazzimon/OBDient`.

---

## Contexto y problema

`hypercore-knowledge.datasource.ts` importaba `hypercore`/`hyperswarm`
directamente, pero Hermes no tiene los built-ins de Node que esas librerías
necesitan (`net`, `fs`, `dgram`). Metro los redirigía a stubs no-op
(`stubs/hypercore.js`, `stubs/hyperswarm.js`), así que **la red de conocimiento
distribuido nunca corrió en el teléfono**: `getChunks`/`getPatterns` devolvían
siempre lo mismo que un feed vacío. El spike C0 ya había probado que el stack
real corre dentro del worklet Bare (`react-native-bare-kit`), y C1 lo usó para la
cosecha de casos (`harvest-outbox`). Faltaba enrutar el conocimiento por el mismo
sustrato (**C2**), y con feeds fluyendo en vivo el defecto de ingest de ADR-0010
(sin listener de `append`, **Fase 1**) recién muerde — por eso van emparejados.

Dos tensiones de diseño:

1. **Hot path síncrono.** `llm.repository.impl.ts` llama `getChunks`/`getPatterns`
   en medio del ensamblado del prompt. Un round-trip IPC por lectura es inviable.
2. **Dónde vive la semántica de confianza.** `trustRegistry` y `shimiTree` son
   MMKV (solo Hermes). No pueden mudarse a Bare.

## Decisión

### Un solo runtime Bare, IPC multiplexado por `ns`

Un worklet compartido ([`p2p/p2p-worklet.mjs`](../../p2p/p2p-worklet.mjs)) hospeda
**ambos** feeds del dispositivo — para no pagar dos runtimes nativos en un
teléfono. El host RN ([`worklet-host.ts`](../../src/data/datasources/worklet-host.ts))
es un singleton que arranca el worklet una vez y rutea las respuestas por
`${ns}:${step}`; los dos datasources (`harvest-outbox`, `hypercore-knowledge`)
son clientes IPC del mismo host. El protocolo (JSON delimitado por `\n`) lleva un
campo `ns` (`'harvest' | 'knowledge'`); un mensaje sin `ns` cae en `'harvest'`
(back-compat con el probe C0).

### El worklet transporta; Hermes decide

- **Worklet (Bare):** persistencia del feed, swarm, replicación, ciclo de vida de
  feeds remotos ([`RemoteFeedManager`](../../p2p/remote-feed-manager.mjs), P0), cota
  de bytes (P1), y el listener de `append` (F1). Empuja cada bloque ingerido como
  evento no solicitado `{ns:'knowledge', step:'chunk', chunk, peerId}`.
- **RN (Hermes):** un **espejo en memoria** de `chunks`/`patterns` alimentado por
  esos eventos vía `_dispatch` (trust gate + weighting + SHIMI + quorum, idéntico
  a antes). `getChunks`/`getPatterns` leen el espejo — siguen **síncronos**.

### Handshake OBDIENT-RAG/1 (simétrico)

El topic de conocimiento (`obdient-rag-v1`) es device↔device y bidireccional
(a diferencia de `obdient-harvest-v1`, que es device→seed). Cada lado anuncia su
feed key (preámbulo de 32 bytes), lee la del otro (`pause()` + `unshift()` del
sobrante, como OBDIENT-HARVEST/1 en `obdient-seed/src/seed/wire.mjs`) y replica
**ambos** cores sobre la misma conexión (Hypercore reusa el Protomux del socket).
Esto corrige de paso un bug latente de la era-stub: el `_onPeer` viejo abría el
feed remoto **sin la clave del peer** (creaba un writer, no replicaba nada).

## Consecuencias

### Positivas
- El fedRAG corre de verdad en device; se retira el stub de Metro y `stubs/`.
- Un solo runtime Bare para las dos features P2P.
- Cierra ADR-0010 Fase 1 (ingest continuo) sin cambiar la semántica de confianza.
- El hot path sigue síncrono; `_dispatch`/`trustRegistry`/`shimiTree` intactos.

### Negativas / costos
- Duplicación controlada: `RemoteFeedManager` vive como TS testeado
  (`src/…/remote-feed-manager.ts`, 12 tests) **y** como copia ESM que corre en
  Bare (`p2p/remote-feed-manager.mjs`); bare-pack no bundlea TS. Mantener en sync.
- El worklet-host es un colaborador nuevo que multiplexa dos features sobre un
  canal IPC; un `step` mal ruteado cruza features (mitigado: clave `${ns}:${step}`).

### Verificación
`node scripts/knowledge-peer.mjs` hace de segundo device en la PC (el seed no
sirve `obdient-rag-v1`): confirma replicación saliente, ingest, y el listener F1
(Enter → append en caliente). `npm test` verde salvo el test de integración que
exige un Ollama local. Runbook on-device en `docs/ROADMAP-2026-07.md`.

## Alternativas consideradas

- **Worklet dedicado por feature (dos runtimes):** descartado por el usuario —
  duplica el footprint nativo en el teléfono cuando ambos toggles están ON.
- **Mudar `_dispatch`/trust a Bare:** imposible — dependen de MMKV (solo Hermes).
- **Lecturas async por IPC en el hot path:** descartado — round-trip por
  `getChunks` en medio del prompt. El espejo en memoria lo evita.
