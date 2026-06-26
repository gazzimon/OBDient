# ADR-0001: Hipótesis causales reificadas (`CausalHypothesis`)

- **Estado:** Aceptado
- **Fecha:** 2026-06-25 *(documentado retroactivamente: formaliza una decisión ya
  encarnada en `src/data/knowledge/obd-ontology.ts`)*
- **Deciders:** Gustavo (gazzimon)
- **Relacionados:** ADR-0004 (persistencia + aprendizaje Beta-Binomial sobre estos
  nodos), ADR-0005 (indexado episódico por vehículo), PLAN-001 (gate determinístico
  que consume `faultClass`)
- **Repos afectados:** `gazzimon/OBDient` (`src/data/knowledge/obd-ontology.ts`,
  `src/core/utils/dtcParser.ts`)

---

## Contexto y problema

El núcleo del diagnóstico tiene que ir de una entrada (DTC, lectura de PID,
condición live) a una **hipótesis causal** rankeable. Hay tres formas de modelar
ese salto:

1. **`if/else` hardcodeado** por código (DTC X ⇒ causa Y embebida en una rama).
2. **Aristas implícitas** en una tabla plana `dtc → causa`.
3. **Reificar** la hipótesis causal como un **nodo de primer nivel**, direccionable
   por id estable, con su `faultClass`, su closure jerárquico y su provenance.

Las dos primeras no escalan a lo que OBDient necesita aguas abajo: un lazo de
aprendizaje que acumule evidencia por hipótesis (ADR-0004) y una memoria episódica
que indexe hipótesis por vehículo (ADR-0005). Si la hipótesis es un efecto
colateral de una rama de código o una fila anónima, **no se le puede colgar
evidencia, ni priors, ni provenance, ni auditar su origen**. Tampoco se puede
derivar `faultClass` por closure transitivo de forma reproducible.

## Drivers de decisión

- **Direccionabilidad:** cada hipótesis necesita un id estable para que el feedback
  humano (👍/👎) y la evidencia post-hoc apunten a la entidad exacta.
- **Closure `subClassOf`:** el `faultClass` de un DTC debe derivarse navegando
  ancestros, no listándose a mano por código.
- **Substrato para ADR-0004/0005:** persistencia con priors e indexado por vehículo
  presuponen que la hipótesis ya es una entidad reificada.
- **Provenance estricta** entre conocimiento curado (ontología) y, a futuro,
  aprendido (ADR-0004 `source: ontology | learned`).
- **Offline-first, sin migración prematura:** la reificación se modela primero
  in-memory; la tabla SQLite es trabajo de ADR-0004, no de este ADR.

## Decisión

Modelamos las hipótesis causales como **nodos reificados de primer nivel**. Hoy la
materialización es la **ontología SKOS in-memory** de
[`obd-ontology.ts`](../../src/data/knowledge/obd-ontology.ts):

- Cada `SkosConceptNode` tiene un **id URI-style estable** (snake_case), `broader` /
  `narrower` (el closure `subClassOf`), `related` (relaciones cruzadas) y los `dtcs`
  que le pertenecen canónicamente.
- El **`faultClass` de un DTC** = nodo canónico (`conceptForDtc(dtc)`) **+** su
  cadena de ancestros (`ancestors(id)`). Esa función ya está implementada
  (`retrievalContext`), y es el análogo funcional de una jerarquía `subClassOf`.
- Una **`CausalHypothesis` reificada** es, conceptualmente, el par
  `(faultClass, effectDtc)` direccionable. ADR-0001 decide **el modelo**
  (reificación); ADR-0004 decide **la persistencia y el aprendizaje** sobre él
  (tabla `causal_hypothesis` con `priorAlpha`/`priorBeta`); ADR-0005 decide **el
  indexado por vehículo**.

### Frontera explícita: reificado ≠ persistido

"Reificado" significa **direccionable como entidad**, no "guardado en SQLite".
Hoy los nodos viven in-memory y eso **alcanza** para el closure y el retrieval. La
tabla `causal_hypothesis` que esquematiza ADR-0004 es la *materialización futura*
de estos nodos (sus Fases 1–2), no un prerequisito de este ADR. No se materializa
prematuramente — mismo criterio que PLAN-001 §5.

### Deuda conocida que este ADR explicita

El `faultClass` hoy está **disperso** entre la severidad por rango SAE de
[`dtcParser.classifySeverity()`](../../src/core/utils/dtcParser.ts) y el closure
SKOS de `obd-ontology.ts`. Consolidarlo en un único `faultClassFor()` puro es
trabajo de ADR-0006 (núcleo determinístico), que depende de esta reificación.

## Consecuencias

### Positivas

- Ids estables → provenance y feedback dirigido ya funcionan (`confirmDtc` /
  `weakenDtc` en `shimi-tree.ts` mueven la confianza del nodo canónico).
- El closure por ancestros ya está implementado y es reproducible.
- Substrato listo para que ADR-0004 cuelgue priors y ADR-0005 indexe por vehículo,
  sin reabrir el modelo.

### Negativas / costos

- Quedan **dos representaciones a reconciliar** a futuro: el concepto SKOS
  in-memory (hoy) y la fila `causal_hypothesis` persistida (ADR-0004). La fuente de
  verdad debe quedar inequívoca cuando se materialice.
- El `faultClass` disperso obliga a una consolidación pendiente (ADR-0006).

### Riesgos y mitigaciones

- **Drift entre ontología curada e hipótesis aprendidas** → ADR-0004 lo mitiga con
  el campo `source: ontology | learned` y cola de curación.

## Alternativas consideradas

- **`if/else` hardcodeado:** descartado. No es auditable, no acumula evidencia, no
  deriva `faultClass` por closure.
- **Aristas implícitas en tabla plana `dtc → causa`:** descartado. La hipótesis no
  es direccionable; no se le puede colgar provenance ni priors.
- **Persistir ya en SQLite (`causal_hypothesis`) como parte de esta decisión:**
  diferido a ADR-0004. La ontología in-memory ya da el closure; materializar ahora
  sería una migración Drizzle prematura.
