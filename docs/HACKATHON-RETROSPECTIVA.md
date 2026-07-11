# OBDient — Retrospectiva del Hackathon (Tether QVAC, track Mobile)

> 📄 [README](../README.md) · 🎤 [Pitch](../PITCH.md) · 🧠 [Vision](../VISION.md) · 📸 [Artifacts](../ARTIFACTS.md)

Un resumen personal, en primera persona, de lo que armamos durante el hackathon:
las herramientas nuevas que integré por primera vez y, sobre todo, **cómo
desbloqueé la fase inicial**, que fue la más dura.

---

## El punto de partida

OBDient no era un CRUD más: había que hacer convivir tres mundos que normalmente
no se hablan entre sí dentro de un mismo teléfono Android —

1. **Hardware real** — un ELM327 hablando OBD-II por Bluetooth Classic (SPP).
2. **IA 100% on-device** — un LLM corriendo en el celular vía el **QVAC SDK**, sin nube.
3. **Conocimiento estructurado** — un RAG jerárquico (SHIMI + SKOS) en lugar de un
   índice vectorial plano.

Cada uno traía su propio muro. La fase inicial fue, básicamente, derribarlos en orden.

---

## Herramientas nuevas que implementé

Estas fueron las piezas que no había tocado antes y que integré durante el evento:

| Herramienta | Para qué | Dónde quedó |
|---|---|---|
| **QVAC SDK** (Bare runtime + worker bundle de 10 plugins) | Inferencia LLM y embeddings on-device | `qvac/worker.entry.mjs`, `qvac/worker.bundle.js`, `qvac-sdk.datasource.ts` |
| **CARpsy** (Qwen3-0.6B fine-tuneado, GGUF Q4_K_M) | El diagnosticador local, offline | cargado vía QVAC SDK |
| **EmbeddingGemma 300M** (4-bit) | Embeddings para el RAG vectorial on-device | `qvac-rag.datasource.ts` |
| **SHIMI + ontología SKOS** | RAG jerárquico por confianza, no plano | `shimi.datasource.ts`, `obd-ontology.ts` |
| **Ruteo multi-agente determinístico** | Decidir el camino sin latencia ML — luego reemplazado por la máquina de estados de intake (junior local → senior opt-in) | `diagnostic-intake-session.ts` (antes `query-router.ts`) |
| **Instrumentación de auditoría** | Medir load, tokens, TTFT y tok/s por inferencia | `src/core/utils/audit-log.ts`, `audit-*.jsonl` |
| **Hypercore / Hyperswarm (fedRAG)** | Base de RAG federado P2P (escrito, aún no ejercitado) | datasource Hypercore |
| **react-native-bluetooth-classic** | SPP con el ELM327 | `elm327.datasource.ts` |

---

## Los bloqueos de la fase inicial y cómo los resolví

### 1. El SDK de QVAC no es "una librería más" — es un runtime Bare
El primer muro fue conceptual: el QVAC SDK no corre sobre Hermes (el motor JS de
React Native) como un paquete normal. Necesita su propio **worker bundle** con los
plugins compilados. La solución fue generar y versionar el bundle custom de 10
plugins (`bundleSdk`) y arrancar el proyecto en **bare workflow con expo-dev-client**
— nada de Expo Go ni emulador, porque ni el runtime nativo de QVAC ni Bluetooth
Classic existen ahí. Esto definió toda la arquitectura de arranque.

### 2. El modelo no cargaba: `[50008] modelType is required`
Una vez con el runtime en pie, `loadModel()` fallaba en seco. El SDK pedía un
parámetro obligatorio que no estaba documentado a la vista:

```typescript
// ❌ no arrancaba
await loadModel({ modelSrc });
// ✅ con modelType explícito
await loadModel({ modelSrc, modelType: 'llamacpp-completion' });
```

Sin este fix, **nada de la inteligencia existía**. Era el prerequisito de todo.

### 3. El modelo "pensaba en voz alta" en la pantalla
Qwen3 emite tokens de razonamiento `<think>…</think>`. Se filtraban crudos a la UI:
el usuario veía el monólogo interno en vez de la respuesta. Lo resolví con un
`stripThinkingTokens()` aplicado a **todos** los paths de retorno (no solo el feliz).

### 4. La IA respondía a ciegas — sin ver el auto
El modelo respondía "no tengo datos" o inventaba valores porque el contexto que le
mandábamos no incluía las lecturas en vivo. Construí `buildSystemContext()` para
inyectar el snapshot completo de OBD-II (RPM, temperatura, MAF, fuel trims…) en cada
prompt. Recién ahí el diagnóstico se fundamentó en mediciones reales y no en el prior
del modelo.

### 5. El RAG estaba "conectado" pero devolvía vacío
La primera iteración del chat llamaba a SHIMI con `dtcId = undefined`, así que la
capa jerárquica retornaba `[]` siempre y solo corría el vector con la query
conversacional cruda. El desbloqueo fue armar el pipeline de recuperación de verdad:
`buildRetrievalQuery()` + expansión SKOS (`retrievalContext`) → **4 capas**
(claudeKnowledge → SHIMI jerárquico → vector EmbeddingGemma → patrones), de modo que
preguntar por una falla arrastra también el conocimiento de ignición y combustible.

### 6. fedRAG: saber dónde parar
El RAG federado P2P (Hypercore/Hyperswarm) quedó **escrito y compilando pero
stubbeado**: Hermes no tiene host Node.js para correr Hypercore, y en el hackathon
solo lo instalamos en un dispositivo, así que la replicación cross-device nunca se
ejerció. La decisión honesta fue declararlo como **código base arquitectado, no
feature demostrada** — y dejarlo documentado así en el README.

---

## Lo que me llevo

- **El orden importa.** Hardware → carga de modelo → contexto → conocimiento. Saltarse
  un eslabón hacía que el siguiente fallara de forma engañosa.
- **El runtime on-device es el 80% del trabajo invisible.** Hacer que un LLM viva en
  el teléfono (worker bundle, `modelType`, TTFT vs. generación) costó más que la lógica
  de diagnóstico en sí.
- **Medir desde el día uno.** La instrumentación de auditoría (`audit-*.jsonl`)
  convirtió "anda en el celu" en evidencia reproducible: load 9.7 s, TTFT, tok/s.
- **Honestidad sobre lo que no se probó.** Marcar fedRAG como base code, no como demo,
  valió más que inflar el alcance.

---

*Construido por FIUI — Fundación Iniciativa Urbana Inteligente · Misiones, Argentina.*
