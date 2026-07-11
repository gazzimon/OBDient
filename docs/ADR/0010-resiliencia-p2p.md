# ADR-0010: Resiliencia de la capa P2P — ciclo de vida de feeds y deduplicación

- **Estado:** Aceptado
- **Fecha:** 2026-07-10
- **Deciders:** Gustavo (gazzimon)
- **Relacionados:** ADR-0003 (seed peer / malla social que esta decisión endurece),
  ADR-0002 (bundle curado que baja por la malla), ADR-0007 (firma/rotación — el
  otro pilar anti-poisoning). No supersede a ninguno: es un ADR de *fiabilidad*
  sobre la infraestructura que 0003 ya definió.
- **Repos afectados:** `gazzimon/OBDient`
  ([`hypercore-knowledge.datasource.ts`](../../src/data/datasources/hypercore-knowledge.datasource.ts),
  nuevo [`remote-feed-manager.ts`](../../src/data/datasources/remote-feed-manager.ts),
  nuevo [`collections.ts`](../../src/core/utils/collections.ts), tests).

---

## Contexto y problema

Una auditoría SRE externa reportó fallas graves del "RAG federado" (persistencia
solo-RAM, `syncSeed()` sin paginación, `String ==` como métrica de similitud,
`SeedClient` HTTP sin circuit breaker, `delay(5000)` bloqueante, parseo sin
límite). **La verificación contra el repo desmiente el diagnóstico**: describe un
firmware ESP32/C++/PlatformIO que **no existe** en OBDient. La arquitectura real
es RN/Expo 56 + worklet Bare con Hypercore/Hyperswarm; el RAG on-device
([`qvac-rag.datasource.ts`](../../src/data/datasources/qvac-rag.datasource.ts))
persiste en workspaces versionados en disco y usa similitud vectorial real; el
sync es replicación Hypercore (incremental por bloque, transporte Noise cifrado);
el offline-first está diseñado en ADR-0003. Ninguno de los archivos citados por la
auditoría existe.

Sin embargo, **verificar el código real sacó a la luz defectos de fiabilidad
genuinos** en [`hypercore-knowledge.datasource.ts`](../../src/data/datasources/hypercore-knowledge.datasource.ts).
Este ADR los prioriza y fija su resolución. La regla que los ordena es el impacto
sobre una sesión larga con **peer churn** (el seed reconecta constantemente — el
propio worklet lo declara: *"seed churn is normal"*).

## Drivers de decisión

- **Acotamiento de recursos:** una app móvil no puede fugar feeds, descriptores de
  archivo ni disco por cada reconexión de un peer.
- **Corrección del quorum:** el conteo de confirmaciones y el filtrado por DTC
  dependen de que **no haya duplicados** del mismo chunk en memoria.
- **Superficie anti-poisoning:** un peer no confiable no debe poder forzar una
  asignación gigante en el ingest (complementa el re-hash del hub de ADR-0002 y la
  firma de ADR-0007).
- **Testabilidad sin nativo:** aislar la lógica de las dependencias nativas
  (`hypercore`, `hyperswarm`, `expo-file-system`) para poder testear en Node.

## Hallazgos priorizados

| Prio | Hallazgo | Sitio | Estado |
|------|----------|-------|--------|
| **P0** | Fuga de feeds/FD/disco: cada evento `connection` abría un `Hypercore` nuevo en un dir temporal nuevo y **nunca lo cerraba**; un peer que reconecta N veces deja N feeds abiertos. | `_onPeer` | ✅ Resuelto |
| **P1** | `FactChunk` sin dedup: `this.chunks.push(weighted)` sin chequear `id` (los patterns sí deduplicaban). Con la fuga P0 el mismo fact se re-inserta en cada recarga → `getChunks` devuelve duplicados y el quorum se distorsiona. | `_dispatch` | ✅ Resuelto |
| **P1** | `JSON.parse` sin cota de tamaño sobre bloques de peers no confiables (superficie de DoS por asignación). | `_loadFeed` | ✅ Resuelto (mitigado) |
| **P2** | Bootstrap del seed (ADR-0003, `Propuesto`): verificar qué fases (ancla de confianza, snapshot bundleado, pinning node) están cableadas vs. pendientes. | ADR-0003 | ⏳ Seguimiento |
| **P2** | Política de timeout/retry serial ELM327 bajo carga. | `elm327.datasource.ts` | ⏳ Seguimiento |

## Decisión

### P0 — Un feed por peer, con ciclo de vida y tope

Se extrae la gestión de feeds remotos a
[`RemoteFeedManager`](../../src/data/datasources/remote-feed-manager.ts), con tres
invariantes:

1. **Un feed por `peerId`**, reusado entre reconexiones (ref-count por socket, bajo
   un path **estable** por peer en vez del antiguo `${peerId}-${feedIndex}`).
2. **Cierre + limpieza del dir** cuando el **último** socket del peer se va
   (`socket.on('close', …)` → `release`).
3. **Tope de feeds concurrentes** (`MAX_REMOTE_FEEDS = 32`): superado, los peers
   nuevos reciben solo replicación local — un flujo de peers no puede agotar el
   dispositivo.

El manager es **transport-agnóstico** (no importa `hypercore`/`expo`): el llamador
inyecta la *factory* del feed y el callback de limpieza. Esto lo vuelve puro y
unit-testeable en Node.

### P1 — Upsert por id

Se introduce [`upsertById`](../../src/core/utils/collections.ts) (reemplaza en
sitio, preservando orden) y se enruta por ahí tanto `chunks` (facts) como
`patterns` en `_dispatch`, más `contribute`. Una re-entrega del mismo chunk
(reconexión, re-load) refresca en lugar de acumular.

### P1 — Cota de tamaño en el ingest

`_loadFeed` descarta bloques `> MAX_CHUNK_BYTES` (64 KiB) **antes** de `JSON.parse`.
Mitigación, no blindaje total: la API de Hypercore obliga a materializar el bloque
en `feed.get(i)` antes de medirlo; una cota de bytes a nivel de bloque en el
transporte sería el paso siguiente.

## Plan por fases

- **Fase 0 — P0 + P1 (este cambio).** Implementado y cubierto por tests. ✅
- **Fase 1 — Ingest continuo de feeds remotos. ✅ Resuelto (2026-07-11, junto a C2).**
  El defecto (`_loadFeed` corría una sola vez, sin listener de `append`) solo
  mordía con feeds fluyendo en vivo — es decir, cuando C2 aterrizó el fedRAG real
  en device. Ahora la replicación vive en el worklet Bare
  ([`p2p/p2p-worklet.mjs`](../../p2p/p2p-worklet.mjs), `handleKnowledgePeer`):
  tras cargar los bloques existentes del feed remoto se registra
  `remoteFeed.on('append', pump)` (des-registrado al cerrar el socket), de modo
  que cada bloque que llega por replicación tras la apertura se ingiere y se
  empuja al espejo RN por IPC en la misma sesión. El `pump` está serializado (un
  cursor + flag `pumping/again`) para que `append` solapados no salten bloques.
  Verificable con `node scripts/knowledge-peer.mjs` (Enter → append en caliente).
- **Fase 2 — Verificar bootstrap del seed (ADR-0003).** Confirmar estado real de
  ancla de confianza / snapshot / pinning node. ⏳
- **Fase 3 — Timeout/retry ELM327.** Revisar política bajo carga. ⏳

## Consecuencias

### Positivas
- Acota RAM / descriptores / disco bajo churn: el bug de crecimiento ilimitado
  queda cerrado.
- `getChunks`/`getPatterns` dejan de devolver duplicados → quorum y filtrado por
  DTC vuelven a ser correctos.
- Reduce la superficie de DoS por asignación en el ingest.
- La lógica crítica queda aislada y testeada: **12 tests nuevos**
  ([`remote-feed-manager.test.ts`](../../src/__tests__/remote-feed-manager.test.ts),
  [`collections.test.ts`](../../src/__tests__/collections.test.ts)); suite total
  312/312 en verde.

### Negativas / costos
- Un colaborador nuevo (`RemoteFeedManager`) y una utilidad (`upsertById`) que
  mantener.
- El tope `MAX_REMOTE_FEEDS` es un número a calibrar en campo (elegido conservador
  para móvil).

### Riesgos y mitigaciones
- ~~**La Fase 1 (ingest continuo) sigue abierta.**~~ Cerrada el 2026-07-11 junto a
  C2 (ver Plan por fases): el listener de `append` en el worklet ingiere los
  bloques que llegan en caliente. La lógica de ciclo de vida de feeds remotos
  (P0) migró al worklet como copia ESM ([`p2p/remote-feed-manager.mjs`](../../p2p/remote-feed-manager.mjs));
  [`remote-feed-manager.ts`](../../src/data/datasources/remote-feed-manager.ts) y
  sus 12 tests quedan como el **spec probado** que esa copia refleja (bare-pack no
  bundlea TS).
- **La cota de 64 KiB es post-materialización:** mitiga la asignación de parseo,
  no la de `feed.get`. Aceptable como primer corte; el blindaje pleno es trabajo de
  transporte.

## Alternativas consideradas

- **Testear el datasource end-to-end con mocks de hypercore/hyperswarm/expo:**
  descartado. Requiere fakes stateful de replicación (justo lo que no se puede
  falsear barato) y expone métodos privados dirigidos por eventos. Extraer los
  colaboradores puros (`RemoteFeedManager`, `upsertById`) da la misma cobertura de
  la lógica que importa, sin andamiaje frágil.
- **Cerrar el feed remoto en cada `close` sin ref-count:** descartado. Un peer con
  varios sockets simultáneos (normal en Hyperswarm durante churn) cerraría el feed
  bajo los pies de otra conexión viva. El ref-count por peer lo resuelve.
- **Sin tope de feeds (solo dedup por peer):** descartado. La dedup por peer acota
  el caso del peer que reconecta, pero no el de N peers distintos llegando a la vez;
  el tope cubre ese vector.
- **Aceptar la auditoría y reescribir un firmware ESP32:** descartado —
  arquitectura inexistente; ejecutar ese plan sería trabajar sobre ficción.
