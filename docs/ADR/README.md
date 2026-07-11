# Architecture Decision Records — OBDient

Índice y disciplina de los ADRs de OBDient. Un ADR captura **una** decisión de
arquitectura: por qué se tomó, qué consecuencias trae y qué alternativas se
descartaron. Este archivo es el índice; **no** es una decisión y por eso no
consume número de ADR.

## Convenciones (la disciplina)

1. **Un archivo por decisión.** Nada de mezclar dos decisiones en un ADR.
2. **Numeración estable y monótona** (`ADR-NNNN`, cuatro dígitos). Un número, una
   vez asignado, no se reusa ni se renumera — otros ADRs ya lo citan.
3. **Inmutables una vez aceptados.** Un ADR aceptado no se reescribe: si la
   decisión cambia, se abre un ADR nuevo que lo **supersede** y se actualiza el
   `Estado` del viejo a `Superseded por ADR-XXXX`.
4. **Formato fijo** (heredado de 004/005):
   `Estado · Fecha · Deciders · Relacionados · Repos afectados` →
   `Contexto y problema · Drivers de decisión · Decisión · Plan por fases ·
   Consecuencias (positivas / negativas / riesgos) · Alternativas consideradas`.
5. **Estados válidos:** `Propuesto` · `Aceptado` · `Rechazado` · `Superseded`.
6. **`Relacionados` siempre resuelve.** Si un ADR cita `ADR-0001`, ese archivo
   debe existir. Citar un ADR inexistente es una deuda a saldar (ver Huecos).

> **Planes ≠ ADRs.** Un documento `PLAN-NNN` es exploración previa: puede proponer
> abrir varios ADRs, pero no es una decisión por sí mismo. Se co-ubica en
> `docs/ADR/` con prefijo `PLAN-` (`.md`) para tenerlo junto a los ADRs que
> propone, pero **no consume número de ADR** ni es inmutable como ellos.

## Índice

| ADR | Título | Estado | Archivo |
|-----|--------|--------|---------|
| 0001 | Hipótesis causales reificadas (`CausalHypothesis`) | Aceptado | [0001-causal-hypothesis-reificada.md](0001-causal-hypothesis-reificada.md) |
| 0002 | Currículo del senior — destilación a CARpsy y RAG central | Propuesto | [0002-curaduria-senior-rag-central.md](0002-curaduria-senior-rag-central.md) |
| 0003 | Seed peer — bootstrap del conocimiento social P2P | Propuesto | [0003-seed-peer-social-p2p.md](0003-seed-peer-social-p2p.md) |
| 0004 | Learning loop sobre SHIMI (Beta-Binomial conjugado) | Propuesto | [0004-learning-loop-shimi.md](0004-learning-loop-shimi.md) |
| 0005 | Memoria episódica por vehículo | Propuesto | [0005-memoria-episodica-vehiculo.md](0005-memoria-episodica-vehiculo.md) |
| 0006 | Núcleo diagnóstico determinístico con dependencias inyectadas | Propuesto | [0006-nucleo-deterministico-inyectable.md](0006-nucleo-deterministico-inyectable.md) |
| 0006-A | Evidencia sintomática reportada por el usuario (satélite de 0006) | Propuesto | [0006-A-sintomas-reportados-usuario.md](0006-A-sintomas-reportados-usuario.md) |
| 0007 | Firma y rotación de claves de los artefactos distribuidos | Propuesto | [0007-firma-y-rotacion-de-claves.md](0007-firma-y-rotacion-de-claves.md) |
| 0008 | Captura de readiness y freeze frame (Mode 01 PID 01 / Mode 02; Mode 06 fuera) | Propuesto | [0008-readiness-freezeframe-capture.md](0008-readiness-freezeframe-capture.md) |
| 0009 | Admisión local → handoff senior — el junior entrevista, el senior conduce, la sesión persiste | Propuesto | [0009-admision-local-handoff-senior.md](0009-admision-local-handoff-senior.md) |
| 0010 | Resiliencia de la capa P2P — ciclo de vida de feeds y deduplicación | Aceptado | [0010-resiliencia-p2p.md](0010-resiliencia-p2p.md) |

### Documentos de plan relacionados (no son ADRs)

| Doc | Título | Ubicación |
|-----|--------|-----------|
| PLAN-001 | Closed-loop con gate determinístico (patrón arbiter) | [PLAN-001-closed-loop-gate.md](PLAN-001-closed-loop-gate.md) |
| PLAN-002 | Segundo lazo de calidad — validación en campo de un diagnóstico (gate, UI/UX, ComputerPool) | [PLAN-002-field-validation-gate.md](PLAN-002-field-validation-gate.md) |

## Huecos conocidos (deuda de disciplina)

Esto es lo que hay que saldar para que la disciplina cierre — es la base de
trabajo, no decoración:

- ✅ **ADR-0001 redactado.** [0001-causal-hypothesis-reificada.md](0001-causal-hypothesis-reificada.md)
  documenta retroactivamente la reificación que `obd-ontology.ts` ya implementa, y
  deja explícito que *reificado ≠ persistido* (la tabla `causal_hypothesis` es
  trabajo de ADR-0004).
- ✅ **Formato `.md` + slug** adoptado: 0004 y 0005 renombrados desde `.txt`.
- ✅ **0002 y 0003 asignados y redactados.** Cierran el salto 0001→0004: 0002
  (currículo del senior + RAG central) y 0003 (seed peer social P2P).
- ✅ **0006 y 0007 redactados.** 0006 (núcleo determinístico inyectable; prerequisito
  estructural de PLAN-001 y consolidador del `faultClassFor()` que ADR-0001 dejó como
  deuda) y 0007 (firma/rotación de claves; cierra el riesgo abierto en ADR-0003).
- ✅ **0008 redactado.** [0008-readiness-freezeframe-capture.md](0008-readiness-freezeframe-capture.md)
  toma la decisión de hardware (readiness Mode 01 PID 01 → freeze frame Mode 02; Mode 06 fuera) que
  PLAN-001 §4 había reservado para 0007 antes de que 0007 se usara para firma de claves. Es el ADR de
  los hitos M6/M7 de PLAN-002.
- ✅ **0009 redactado.** [0009-admision-local-handoff-senior.md](0009-admision-local-handoff-senior.md)
  redefine el flujo diagnóstico como pipeline de sesión (admisión CARpsy → brief
  determinístico redactado → conversación senior → persistencia append-only) y modifica
  deliberadamente la premisa "lo diagnóstico no sale del device" del router, con contrato
  de datos explícito (viajan datos del vehículo; nunca VIN ni identidad del usuario).
- ✅ **0010 redactado y aceptado.** [0010-resiliencia-p2p.md](0010-resiliencia-p2p.md)
  fija la resolución de los defectos de fiabilidad P2P reales (fuga de feeds por
  reconexión, `FactChunk` sin dedup, ingest sin cota) hallados al verificar una
  auditoría SRE externa cuyo diagnóstico apuntaba a un firmware ESP32 inexistente.
  Es el primer ADR con código ya mergeado (`Aceptado`, no `Propuesto`) y endurece
  la malla de ADR-0003.
- **Numeración al día:** 0001–0010 asignados y redactados; sin huecos. **0006-A** es el
  primer ADR *satélite*: extiende una decisión existente (0006) en vez de tomar una nueva
  independiente, y por eso hereda su número con sufijo de letra en lugar de consumir 0009.
  La regla de "un número, una vez" se mantiene; el sufijo señala dependencia estructural directa.

## Coherencia entre ADRs (lectura cruzada)

Estado de consistencia tras leer 0001 ⋈ 0002 ⋈ 0003 ⋈ 0004 ⋈ 0005 ⋈ 0006 ⋈ 0007 ⋈ PLAN-001:

- ✅ **Principios alineados.** Offline-first, determinismo de la ruta de decisión,
  clock inyectado y aprendizaje/efectos siempre *post-hoc* son consistentes en todos
  los documentos.
- ✅ **`caseSignature` compartida.** ADR-0005 reusa deliberadamente la firma de
  ADR-0004 ([0005 §Relación](0005-memoria-episodica-vehiculo.md)); procedural y
  episódica cuelgan de la misma clave. Coherente.
- ✅ **Columna vertebral del conocimiento.** 0001 (modelo reificado) → 0002 (senior
  cura + destila, central/build-time) → 0003 (seed peer distribuye y arranca lo
  social) → 0004/0005 (aprendizaje local procedural + episódico). Loop cerrado:
  social sube, curado baja.
- ✅ **0002 no contradice 0004.** El retrain de 0002 es **central/batch**; el
  invariante "sin fine-tuning on-device" de ADR-0004 §Alternativas se preserva. El
  fine-tuning local estilo Biomed-AI quedó explícitamente descartado en 0002.
- ✅ **0006 consolida el `faultClass`.** El núcleo puro de ADR-0006 materializa el
  `faultClassFor()` que ADR-0001 dejó como deuda y que PLAN-001 consume en el gate.
- ✅ **0006-A compone como likelihood, no rompe la frontera.** Los síntomas del usuario
  entran al `DiagnosticContext` de 0006 y suman un término de likelihood en log-odds sobre
  el prior jerárquico; el embedding/LLM solo normaliza el texto en el borde (con
  confirmación), nunca decide. Habilita el diagnóstico sin DTC. Reusa nodos (0001),
  Beta-Binomial (0004) y episódico (0005) sin subsistema nuevo.
- ✅ **0007 cierra el riesgo de 0003.** La firma/rotación de claves concreta el
  "firmado" que 0002/0003 asumían y elimina la fragilidad de la clave hardcodeada.
- ⚠️ **Drift de esquema `sessions` ↔ `diagnostic_session`.** ADR-0004 introduce una
  tabla `diagnostic_session` distinta de la `sessions` actual; ADR-0005 ya lo marca
  en su *Nota de reconciliación* y lo asigna a la Fase 0 de ADR-0004. **Ninguna de
  las dos tablas existe aún en `src/data/db/schema.ts`** (solo `sessions`,
  `trouble_codes`, `vehicles`, `pid_readings`). Hueco abierto, ya reconocido.
- ⚠️ **`faultClass` sin función única.** Citado por 0001/0004/PLAN-001 pero disperso
  entre `dtcParser` y la ontología; lo consolida ADR-0006.

## Pasos a seguir

Los ocho ADRs están redactados (todos `Propuesto`, salvo 0001 `Aceptado`). El roadmap
de implementación lo fija **PLAN-002** ([PLAN-002-field-validation-gate.md](PLAN-002-field-validation-gate.md)): el segundo lazo
de calidad (validación en campo de un diagnóstico vía el gate determinístico), con la
columna social/aprendizaje (0002/0003/0004/0005/0007) **congelada como post-MVP**.

> **Actualización 2026-07-06:** ADR-0009 inserta el track de admisión/handoff senior
> como prioridad de producto por encima del orden M1→M3 original: M0 (hecho) → Fase 0-3
> de ADR-0009 (que absorben M1 y la Fase 0-1 de ADR-0006-A) → gate M3 como pre-flight.
>
> **Actualización 2026-07-10 (estado verificado contra el código):** M0 ✅, M1 ✅ y
> UX4 (captura de resultado, tabla `outcomes` + UI tap-only en `reports.tsx`) ✅ están
> construidos; ADR-0009 (admisión → handoff senior con case-base append-only) quedó
> sustancialmente hecho. **M2 (salida estructurada) y M3 (gate G1-G6 + lazo acotado)
> siguen sin construir**: el único gate existente es G0 (entrevista). El pivote a
> handoff senior **re-scopea** M2/M3 — ver la sección *IMPLEMENTATION STATUS — 2026-07-10*
> al inicio de PLAN-002. Falta cerrar el lazo de aprendizaje (Steps 4a/5/6/7 del ROADMAP)
> sobre los datos que UX4 ya empezó a acumular.

1. **Empezar por M0 de PLAN-002** = Fase 0 de ADR-0006 (`faultClassFor()` puro) — cero
   cambio de comportamiento, prerequisito de todo el núcleo.
2. **Seguir el orden M0 → M3** (clasificador de contexto → salida estructurada con riesgo
   invertido → gate G1-G6 + lazo acotado). Persistencia in-memory; SQLite se difiere.
3. **Hardware detrás de feature flag** (M6/M7) según ADR-0008: readiness primero
   (anti-fraude), freeze frame después; Mode 06 fuera.
4. **Promover ADR-0006 a `Aceptado`** al completar M3 (la decisión del gate se fija).
5. **ComputerPool** (PLAN-002 §7) queda como track de exploración post-MVP, supeditado a
   resolver el contrato de privacidad que ADR-0003 §Alternativas dejó explícito.

## Cómo abrir un ADR nuevo

1. Tomá el siguiente número libre de la tabla (no reuses).
2. Copiá el esqueleto de [0004-learning-loop-shimi.md](0004-learning-loop-shimi.md)
   o [0005-memoria-episodica-vehiculo.md](0005-memoria-episodica-vehiculo.md).
3. Estado inicial `Propuesto`; completá `Relacionados` con ADRs que existan.
4. Agregá la fila a la tabla de Índice de este README.
