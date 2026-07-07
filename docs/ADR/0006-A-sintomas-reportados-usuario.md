# ADR-0006-A: Evidencia sintomática reportada por el usuario

- **Estado:** Propuesto
- **Fecha:** 2026-06-26
- **Deciders:** Gustavo (gazzimon)
- **Relacionados:** ADR-0006 (núcleo determinístico — extiende su `DiagnosticContext`
  y su `rankHypotheses`; éste es un ADR satélite suyo), ADR-0001 (reificación de nodos
  — agrega el nodo `Symptom` y la arista `manifestsAs`), ADR-0004 (Beta-Binomial — los
  pesos síntoma→hipótesis se aprenden con la misma maquinaria), ADR-0005 (memoria
  episódica — los síntomas reportados quedan en el ledger del vehículo)
- **Repos afectados:** `gazzimon/OBDient` (`data/knowledge/obd-ontology.ts`,
  `domain/services/diagnostic-core.ts`, `domain/entities`, UI de captura, `__tests__`)

---

## Contexto y problema

El núcleo diagnóstico de ADR-0006 solo consume **lo que el auto reporta por OBD**:
`dtcSet`, `freezeFrame` y PIDs live. Esa es una sola fuente de evidencia —la de la
máquina— y deja dos huecos concretos:

1. **El caso sin DTC es un punto ciego total.** Un golpeteo en frío, humo blanco, olor
   a combustible, tironeo al acelerar: muchísimos diagnósticos reales arrancan con un
   síntoma humano y **no encienden ningún DTC**. Hoy, con el OBD mudo, `rankHypotheses`
   no tiene de qué agarrarse y el núcleo no produce ranking.
2. **Aun con DTC, falta la mitad de la evidencia.** El mismo `P0301` con "se sacude en
   frío y mejora en caliente" apunta distinto que con "humo azul constante". El síntoma
   reportado discrimina entre hipótesis que el DTC solo no separa.

El problema de diseño es uno solo y es el que este ADR resuelve: **el síntoma es
lenguaje natural, pero el núcleo de ADR-0006 es determinista.** Si se deja que un LLM
interprete el texto del usuario y eso decida la causa, se rompe la frontera "el núcleo
decide, el sampler narra" (ADR-0006 §Frontera). La pregunta real no es *si* sumamos
síntomas, sino *cómo entra el texto libre sin meter al LLM en la ruta de decisión*.

## Drivers de decisión

- **Preservar la frontera de ADR-0006.** El LLM/embedding puede *normalizar* la entrada,
  nunca *decidir* la salida. La decisión opera solo sobre conceptos estructurados.
- **Habilitar el diagnóstico sin DTC.** El núcleo debe poder rankear con síntomas como
  única evidencia.
- **Determinismo y reproducibilidad** al nivel del resto del núcleo: mismo input + mismo
  `knowledgeVersion` ⇒ mismo ranking.
- **Reuso de lo que ya existe:** el modelo de nodos reificados (ADR-0001), el lazo
  Beta-Binomial (ADR-0004), EmbeddingGemma (ya en el RAG de 4 capas) y el `DiagnosticContext`
  de ADR-0006.
- **Offline-first y baja fricción:** la captura primaria no puede depender de red ni de
  un modelo, y debe poder saltarse sin penalizar (degradación con gracia).

## Decisión

Adoptamos los **síntomas reportados como segunda fuente de evidencia**, modelados como
**nodos reificados** y consumidos por el núcleo como un **término de likelihood** que se
compone, en log-odds, con el prior jerárquico de ADR-0006. Cuatro piezas:

### 1. `Symptom` reificado + arista `manifestsAs` (extensión de ADR-0001)

Igual que `CausalHypothesis`, el síntoma es un nodo SKOS de primer nivel, con id estable,
dentro de una **taxonomía curada** (driveability, arranque, ralentí, ruidos, olores, humo,
fluidos, temperatura, eléctrico…). Se conecta a las hipótesis con una arista nueva con peso:

```
CausalHypothesis  —manifestsAs(weight)→  Symptom
```

Esto convierte "humo blanco" de texto suelto en **evidencia estructurada y direccionable**
que el núcleo usa sin LLM. El peso arranca curado y se vuelve aprendible (pieza 4).

### 2. El síntoma entra como LIKELIHOOD, no como prior ni como `caseSignature`

En términos bayesianos, el prior jerárquico de ADR-0006 responde "¿qué tan probable es la
hipótesis *antes* de mirar síntomas?"; el síntoma es el **likelihood**: "¿los síntomas
reportados coinciden con los que esta hipótesis produce?".

```
posterior(h) ∝ prior_jerárquico(h)  ×  likelihood(síntomas | h)
              └ ontología→modelo→caso→auto (ADR-0006)   └ este ADR
```

En log-odds es **aditivo y determinista** —se enchufa sin tocar la cascada del prior:

```typescript
// src/domain/services/diagnostic-core.ts — PURO, sin I/O, sin LLM.

export interface SymptomEvidence {            // por arista (hipótesis, síntoma)
  pHit: number;  // P(síntoma | hipótesis)      — Beta-estimado o curado
  pFp:  number;  // P(síntoma | ¬hipótesis)     — tasa de falso positivo del síntoma
}
const LAMBDA_ABSENT = 0.5;  // peso del castigo por síntoma esperado-y-ausente (versionado)

// llr de un síntoma para una hipótesis: cuánto evidencia a favor (o en contra).
function llr(e: SymptomEvidence): number {
  return Math.log(e.pHit / e.pFp);            // > 0 si el síntoma apunta a la hipótesis
}

// Ajuste de likelihood en log-odds. `reported` y `expected` son sets de SymptomId.
export function symptomLogOdds(
  h: HypothesisId,
  reported: Set<SymptomId>,
  expected: Map<SymptomId, SymptomEvidence>,  // manifestsAs(h, ·) desde la ontología
): number {
  let delta = 0;
  for (const [s, e] of expected) {
    if (reported.has(s)) delta += llr(e);                 // esperado y reportado → sube
    else                 delta -= LAMBDA_ABSENT * llr(e); // esperado y AUSENTE → baja
  }
  return delta;                                            // 0 si el usuario no reportó nada
}

// rankHypotheses combina, en log-odds, prior (ADR-0006) + síntomas (este ADR):
//   logit_post(h) = logit(priorScore(h)) + symptomLogOdds(h, reported, expected(h))
```

Propiedades:
- **Sin síntomas reportados** (`reported = ∅`) → `delta = 0` y el ranking es idéntico al
  de ADR-0006. Degradación con gracia, regresión cero.
- **Sin DTC pero con síntomas** → el prior jerárquico (apoyado en la falla crónica del
  **modelo**, ADR-0006) × likelihood produce un ranking aunque el OBD esté mudo. **Es la
  capacidad nueva.**
- **Síntoma esperado-y-ausente castiga** (término `LAMBDA_ABSENT`): una hipótesis que
  debería producir humo blanco y el usuario reporta que no hay, baja. Evidencia negativa,
  no solo positiva.
- **Determinismo preservado:** aritmética sobre conteos/pesos versionados por
  `knowledgeVersion`; el LLM no aparece en esta función.

### 3. Captura de la entrada: estructurada primero, texto libre normalizado

Dos modalidades, en orden de prioridad, **después de leer los DTC y antes de generar la
explicación**:

- **Picker estructurado (primario, 100% determinista, offline).** "¿El auto presenta
  alguno de estos síntomas?", con la lista **pre-filtrada por los `faultClass` ya
  detectados** (los síntomas relacionados por `manifestsAs` a las hipótesis vivas, más un
  set común) para no abrumar. El tilde mapea directo a nodos `Symptom`. Cero LLM.
- **Texto libre (secundario, normalizado en el borde).** Caja de texto → **EmbeddingGemma**
  (ya en el RAG de 4 capas) mapea el texto a los nodos `Symptom` más cercanos → **el
  usuario confirma** los conceptos sugeridos → recién ahí entran al núcleo. El embedding
  actúa como *normalizador de entrada*, no como decididor; la sugerencia se snapshotea y
  se confirma.

**Frontera explícita:** el embedding/LLM traduce *texto → concepto* en el borde de entrada;
el núcleo decide solo sobre el set de `SymptomId` **confirmado**. Reproducible y auditable
(el texto crudo y el mapeo confirmado viven en el snapshot de sesión, verdad inmutable del
ADR-0005).

### 4. `symptoms` en el `DiagnosticContext` (extiende ADR-0006)

```typescript
// ADR-0006 DiagnosticContext, ampliado:
interface DiagnosticContext {
  // … dtcSet, faultClass, make/model/year/engine, freezeFrame (ADR-0004/0006) …
  symptoms: SymptomId[];        // set confirmado, estructurado; [] si el usuario lo saltó
}
```

Los síntomas confirmados se registran además en el **ledger episódico del ADR-0005**
("este auto reportó ralentí inestable en 3 visitas") y sus pesos `manifestsAs` se
**aprenden con el Beta-Binomial del ADR-0004** (un `manifestsAs` confirmado/refutado por
outcome actualiza `pHit`/`pFp`), cerrando el lazo sin maquinaria nueva.

## Plan de implementación por fases

Al estilo de ADR-0004/0005/0006: cada fase despliega sola y de-riskea la siguiente.

- **Fase 0 — Taxonomía + `manifestsAs` (in-memory, curado).** Subárbol SKOS de síntomas
  en `obd-ontology.ts` y aristas `hipótesis→síntoma` con peso curado. `expectedSymptoms(h)`
  y el pre-filtro `faultClass → síntomas`. Cero cambio de comportamiento. Prerequisito.
- **Fase 1 — Picker estructurado + `symptoms` en `DiagnosticContext`.** Captura en UI tras
  leer DTC; los síntomas se registran y se snapshotean, **sin afectar el ranking todavía**.
  Riesgo bajo.
- **Fase 2 — Likelihood en `rankHypotheses`.** `symptomLogOdds()` enchufado en log-odds con
  el prior. A/B con `eval-carpsy.js` antes de mover la frontera, igual que el prior de
  ADR-0006. Habilita el **flujo sin DTC**. Riesgo medio.
- **Fase 3 — Texto libre vía EmbeddingGemma + confirmación.** Mapeo texto→concepto en el
  borde, con paso de confirmación del usuario. Riesgo medio.
- **Fase 4 — Pesos aprendibles + registro episódico.** `pHit`/`pFp` por Beta-Binomial
  (compone con ADR-0004); síntomas en el ledger del ADR-0005. Riesgo bajo.

## Consecuencias

### Positivas
- **Diagnóstico sin DTC deja de ser punto ciego:** el núcleo rankea con síntomas + falla
  crónica del modelo aunque el OBD esté mudo.
- Segunda fuente de evidencia que discrimina entre hipótesis que el DTC solo no separa.
- Compone con todo lo existente: nodos (0001), Beta-Binomial (0004), episódico (0005),
  EmbeddingGemma; no introduce un subsistema nuevo de aprendizaje.
- Frontera de ADR-0006 intacta: el LLM/embedding normaliza, el núcleo decide; el texto
  crudo y el mapeo confirmado son auditables.
- Degradación con gracia: sin síntomas, ranking idéntico al de ADR-0006.

### Negativas / costos
- **Mantener una taxonomía de síntomas curada** es trabajo de dominio continuo.
- Un paso más de UI en el flujo (mitigado: opcional y pre-filtrado).
- La evidencia negativa (`LAMBDA_ABSENT`) suma un hiperparámetro a calibrar.

### Riesgos y mitigaciones
- **Sesgo de auto-reporte** (el usuario describe mal o exagera) → la evidencia es
  *likelihood*, no certeza: pondera, no decide sola; el prior jerárquico la contrapesa, y
  el peso `manifestsAs` aprendido corrige los síntomas poco confiables con el tiempo.
- **Mapeo texto→concepto erróneo de EmbeddingGemma** → confirmación obligatoria del usuario
  antes de entrar a la decisión; el texto crudo queda en el snapshot para auditar.
- **`LAMBDA_ABSENT` y los pesos curados sin calibrar** → constantes **versionadas por
  `knowledgeVersion`**, barridas con `eval-carpsy.js`; defaults conservadores hasta tener datos.
- **PII en el texto libre** (placas, nombres, ubicaciones) → el texto vive solo en el
  snapshot local; nunca cruza a la nube salvo el opt-in explícito del camino `general` del
  router, que ya envía solo make/model/year + pregunta.

## Alternativas consideradas

- **Que el LLM interprete el síntoma y decida la causa:** descartado. Mete un modelo no
  determinista en la ruta de decisión y rompe la frontera de ADR-0006. El LLM se queda como
  normalizador del borde, nunca como decididor.
- **Meter los síntomas en el `caseSignature` (ADR-0004):** descartado. Los volvería parte
  de la clave rígida: cualquier diferencia de síntomas fragmentaría los conteos y
  dispersaría el aprendizaje, además de exigir coincidencia exacta. Como *likelihood*
  ponderan de forma graduada y componen con el prior.
- **Solo texto libre, sin taxonomía estructurada:** descartado. No es determinista, no
  permite pre-filtrado por `faultClass` ni aristas aprendibles, y obliga al embedding en el
  hot path. El picker estructurado es la fuente primaria; el texto libre, asistido.
- **Síntomas como evidencia solo positiva (sin castigo por ausencia):** descartado como
  default. El término esperado-y-ausente es lo que deja descartar hipótesis cuyo síntoma
  cardinal el usuario niega; se puede atenuar con `LAMBDA_ABSENT`, no eliminar.

---

## Apéndice A — Taxonomía de síntomas (insumo de Fase 0)

Primer corte curado del subárbol SKOS de síntomas y de las aristas `manifestsAs`. Los
nodos `Symptom` reusan el **mismo `SkosConceptNode`** de `obd-ontology.ts` (`broader` =
categoría, raíz `symptom`); la arista con peso vive **aparte** para no inflar los nodos ni
mezclar el árbol de causas con el de síntomas:

```typescript
// src/data/knowledge/symptom-ontology.ts (nuevo, junto a obd-ontology.ts)

// Arista hipótesis(causa)→síntoma. `hypothesis` es un id de OBD_ONTOLOGY; `symptom`, un
// id del subárbol de abajo. `weight` es curado y mapea a un llr (ADR §2, Decisión 2):
//   strong → pHit≈.80 / pFp≈.15 → llr ≈ +1.67
//   medium → pHit≈.50 / pFp≈.25 → llr ≈ +0.69
//   weak   → pHit≈.30 / pFp≈.25 → llr ≈ +0.18
export interface ManifestsEdge {
  readonly hypothesis: string;
  readonly symptom: string;
  readonly weight: 'strong' | 'medium' | 'weak';
}
// expectedSymptoms(h)  = aristas con hypothesis === h  → el término de likelihood.
// pre-filtro del picker = síntomas de las aristas cuya hypothesis ∈ faultClassClosure(dtc).
// Los pesos se vuelven aprendibles en Fase 4 (Beta-Binomial, ADR-0004): pHit/pFp = α/(α+β).
```

### Árbol de categorías (`broader = symptom`)

`driveability · starting · idle · noise · smell · smoke · fluid · temperature · electrical · dash`

### Aristas `manifestsAs` curadas (síntoma → hipótesis : peso)

**Manejo (`driveability`)**
- `sym_hesitation` (tironeo/duda al acelerar) → fuel_delivery **strong**, sensor_maf medium, throttle medium, misfire_random medium, fuel_injectors medium
- `sym_power_loss` (falta de potencia) → turbo **strong**, fuel_delivery medium, catalyst medium, fuel_lean medium, sensor_maf medium
- `sym_surging` (cabeceo de RPM) → live_rpm **strong**, fuel_mixture medium, throttle medium, vvt weak
- `sym_knock_ping` (cascabeleo/pistoneo) → sensor_knock **strong**, timing_correlation medium, fuel_lean medium, egr weak
- `sym_stall` (se apaga en marcha) → fuel_delivery **strong**, sensor_crank medium, fuel_lean medium, throttle medium
- `sym_harsh_shift` (cambios bruscos) → transmission **strong**

**Arranque (`starting`)**
- `sym_no_start` (no arranca) → sensor_crank **strong**, fuel_delivery **strong**, live_voltage medium
- `sym_hard_start_cold` (difícil en frío) → sensor_temperature **strong**, fuel_mixture medium, fuel_delivery medium
- `sym_hard_start_hot` (difícil en caliente) → fuel_rich medium, fuel_delivery medium, sensor_o2 weak
- `sym_long_crank` (gira mucho antes de arrancar) → fuel_delivery **strong**, sensor_crank medium, sensor_cam medium

**Ralentí (`idle`)**
- `sym_rough_idle` (ralentí inestable/vibra) → misfire_random **strong**, misfire_cylinder medium, fuel_mixture medium, egr medium, live_rpm medium, vvt weak
- `sym_high_idle` (ralentí alto) → throttle **strong**, live_rpm medium, vvt weak
- `sym_low_idle` (ralentí bajo/se ahoga) → fuel_mixture medium, throttle medium

**Ruidos (`noise`)**
- `sym_engine_knock_noise` (golpeteo metálico de motor) → live_oil **strong**, timing_correlation medium
- `sym_hiss_vacuum` (silbido/succión) → fuel_lean **strong**, turbo medium, evap weak
- `sym_exhaust_rattle` (cascabeleo en el escape) → catalyst **strong**

**Olores (`smell`)**
- `sym_smell_fuel` (a combustible) → fuel_rich **strong**, fuel_injectors medium, evap medium
- `sym_smell_burning` (a quemado) → live_oil medium, catalyst medium
- `sym_smell_sulfur` (a azufre/huevo podrido) → catalyst **strong**, fuel_rich medium
- `sym_smell_coolant` (dulce/refrigerante) → live_overheat **strong**

**Humo (`smoke`)**
- `sym_smoke_white` (humo blanco) → live_overheat **strong**, sensor_temperature weak
- `sym_smoke_blue` (humo azul) → live_oil **strong**, vvt weak
- `sym_smoke_black` (humo negro) → fuel_rich **strong**, sensor_maf medium, fuel_injectors medium

**Fluidos (`fluid`)**
- `sym_coolant_leak` (pérdida de refrigerante) → live_overheat **strong**
- `sym_oil_leak` (pérdida de aceite) → live_oil **strong**
- `sym_fuel_leak` (pérdida de combustible) → fuel_injectors **strong**, fuel_delivery medium

**Temperatura (`temperature`)**
- `sym_overheating` (sobrecalienta — aguja alta) → live_overheat **strong**, sensor_temperature medium
- `sym_no_warmup` (no calienta / tarda — termostato) → sensor_temperature **strong**

**Eléctrico (`electrical`)**
- `sym_dim_flicker_lights` (luces tenues/parpadean) → live_voltage **strong**
- `sym_battery_drain` (se descarga la batería) → live_voltage **strong**
- `sym_accessory_fault` (accesorios/electrónica fallan) → live_voltage medium, network medium

**Tablero / testigos (`dash`)**
- `sym_cel_flashing` (check engine titilando) → misfire_random **strong**, misfire_cylinder **strong**
- `sym_temp_light` (testigo de temperatura) → live_overheat **strong**
- `sym_oil_light` (testigo de aceite) → live_oil **strong**
- `sym_battery_light` (testigo de batería) → live_voltage **strong**

**Consumo (`driveability`)**
- `sym_high_consumption` (consume mucho) → fuel_rich **strong**, sensor_o2 medium, sensor_maf medium, catalyst weak

> **Notas.** (1) `sym_cel_flashing` es el síntoma más fuerte del set: un misfire activo
> que titila el testigo daña el catalizador — peso `strong` a ambas clases de misfire.
> (2) Varios síntomas (`sym_smell_burning`, `sym_smoke_white`) apuntan a `live_*`, nodos
> de condición que **no** tienen DTC: son justo los casos que el flujo sin-DTC habilita.
> (3) Este corte es el *seed* curado; la cobertura se amplía y los pesos se recalibran con
> el Beta-Binomial de la Fase 4. Faltan deliberadamente ramas Body/Chassis (frenos, dirección,
> suspensión) hasta que la ontología de causas (`obd-ontology.ts`) las cubra — hoy `body` y
> `chassis` están vacíos, así que un síntoma de esa rama no tendría hipótesis que enganchar.
