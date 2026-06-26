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

> **Planes ≠ ADRs.** Un documento `PLAN-NNN` (p. ej. `001.txt` en la raíz del
> repo) es exploración previa: puede proponer abrir varios ADRs, pero no es una
> decisión por sí mismo. No vive en `docs/ADR/` ni consume número de ADR.

## Índice

| ADR | Título | Estado | Archivo |
|-----|--------|--------|---------|
| 0001 | Hipótesis causales reificadas (`CausalHypothesis`) | Aceptado | [0001-causal-hypothesis-reificada.md](0001-causal-hypothesis-reificada.md) |
| 0002 | Currículo del senior — destilación a CARpsy y RAG central | Propuesto | [0002-curaduria-senior-rag-central.md](0002-curaduria-senior-rag-central.md) |
| 0003 | Seed peer — bootstrap del conocimiento social P2P | Propuesto | [0003-seed-peer-social-p2p.md](0003-seed-peer-social-p2p.md) |
| 0004 | Learning loop sobre SHIMI (Beta-Binomial conjugado) | Propuesto | [0004-learning-loop-shimi.md](0004-learning-loop-shimi.md) |
| 0005 | Memoria episódica por vehículo | Propuesto | [0005-memoria-episodica-vehiculo.md](0005-memoria-episodica-vehiculo.md) |
| 0006 | Núcleo diagnóstico determinístico con dependencias inyectadas | Propuesto | [0006-nucleo-deterministico-inyectable.md](0006-nucleo-deterministico-inyectable.md) |
| 0007 | Firma y rotación de claves de los artefactos distribuidos | Propuesto | [0007-firma-y-rotacion-de-claves.md](0007-firma-y-rotacion-de-claves.md) |

### Documentos de plan relacionados (no son ADRs)

| Doc | Título | Ubicación |
|-----|--------|-----------|
| PLAN-001 | Closed-loop con gate determinístico (patrón arbiter) | [../../001.txt](../../001.txt) |

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
- **Numeración al día:** 0001–0007 asignados y redactados; sin huecos.

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

Los siete ADRs están redactados (todos `Propuesto`, salvo 0001 `Aceptado`). Lo que
queda es **implementación y dos decisiones de editor**:

1. **Empezar por la Fase 0 de ADR-0006** (`faultClassFor()` puro) — cero cambio de
   comportamiento, prerequisito de PLAN-001 y de todo el núcleo.
2. **Decidir la reconciliación `sessions` ↔ `diagnostic_session`** (Fase 0 de
   ADR-0004) antes de materializar cualquier tabla nueva.
3. **Revisar como editor** dos puntos abiertos: si ADR-0002 se siente cargado
   (RAG + destilación en una decisión), y confirmar el *pinning node* central de
   ADR-0003.
4. **Promover a `Aceptado`** los ADRs `Propuesto` que ya quieras fijar como
   inmutables.

## Cómo abrir un ADR nuevo

1. Tomá el siguiente número libre de la tabla (no reuses).
2. Copiá el esqueleto de [0004-learning-loop-shimi.md](0004-learning-loop-shimi.md)
   o [0005-memoria-episodica-vehiculo.md](0005-memoria-episodica-vehiculo.md).
3. Estado inicial `Propuesto`; completá `Relacionados` con ADRs que existan.
4. Agregá la fila a la tabla de Índice de este README.
