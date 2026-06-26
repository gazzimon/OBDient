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
| 0002 | — | Sin asignar | — |
| 0003 | — | Sin asignar | — |
| 0004 | Learning loop sobre SHIMI (Beta-Binomial conjugado) | Propuesto | [0004-learning-loop-shimi.md](0004-learning-loop-shimi.md) |
| 0005 | Memoria episódica por vehículo | Propuesto | [0005-memoria-episodica-vehiculo.md](0005-memoria-episodica-vehiculo.md) |
| 0006 | Núcleo diagnóstico determinístico con dependencias inyectadas | Borrador | — (propuesto, sin redactar) |

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
- **0002 y 0003 nunca se asignaron.** El salto 0001→0004 sigue siendo un hueco;
  reservados aquí explícitamente hasta que se les asigne una decisión.
- **ADR-0006 (núcleo determinístico inyectable)** está en borrador; al redactarlo,
  explicitar que es prerequisito estructural de PLAN-001 (gate determinístico) y el
  que consolida el `faultClassFor()` que ADR-0001 dejó como deuda.

## Coherencia entre ADRs (lectura cruzada)

Estado de consistencia tras leer 0001 ⋈ 0004 ⋈ 0005 ⋈ PLAN-001:

- ✅ **Principios alineados.** Offline-first, determinismo de la ruta de decisión,
  clock inyectado y aprendizaje/efectos siempre *post-hoc* son consistentes en los
  cuatro documentos.
- ✅ **`caseSignature` compartida.** ADR-0005 reusa deliberadamente la firma de
  ADR-0004 ([0005 §Relación](0005-memoria-episodica-vehiculo.md)); procedural y
  episódica cuelgan de la misma clave. Coherente.
- ✅ **Cadena de dependencias clara.** 0001 (modelo reificado) → 0004 (persiste +
  aprende) → 0005 (indexa por vehículo); PLAN-001/0006 consumen el `faultClass`.
- ⚠️ **Drift de esquema `sessions` ↔ `diagnostic_session`.** ADR-0004 introduce una
  tabla `diagnostic_session` distinta de la `sessions` actual; ADR-0005 ya lo marca
  en su *Nota de reconciliación* y lo asigna a la Fase 0 de ADR-0004. **Ninguna de
  las dos tablas existe aún en `src/data/db/schema.ts`** (solo `sessions`,
  `trouble_codes`, `vehicles`, `pid_readings`). Hueco abierto, ya reconocido.
- ⚠️ **`faultClass` sin función única.** Citado por 0001/0004/PLAN-001 pero disperso
  entre `dtcParser` y la ontología; lo consolida ADR-0006.

## Pasos a seguir

1. **Leer [ADR-0001](0001-causal-hypothesis-reificada.md)** — es la base: define el
   modelo reificado del que cuelgan 0004, 0005 y 0006.
2. **Redactar ADR-0006** (núcleo determinístico inyectable) tomando 0001 como
   prerequisito; ahí se materializa `faultClassFor()`.
3. **Decidir la reconciliación `sessions` ↔ `diagnostic_session`** (Fase 0 de
   ADR-0004) antes de materializar cualquier tabla nueva.
4. **Asignar o reservar formalmente 0002/0003**, o renumerar para cerrar el salto.

## Cómo abrir un ADR nuevo

1. Tomá el siguiente número libre de la tabla (no reuses).
2. Copiá el esqueleto de [0004-learning-loop-shimi.md](0004-learning-loop-shimi.md)
   o [0005-memoria-episodica-vehiculo.md](0005-memoria-episodica-vehiculo.md).
3. Estado inicial `Propuesto`; completá `Relacionados` con ADRs que existan.
4. Agregá la fila a la tabla de Índice de este README.
