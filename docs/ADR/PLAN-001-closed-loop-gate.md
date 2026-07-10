# PLAN-001: Closed-loop con gate determinístico (patrón arbiter) sobre el diagnóstico OBDient

- **Estado:** Borrador / plan (NO es un ADR todavía; ver §ADRs a abrir)
- **Fecha:** 2026-06-25
- **Autor:** arquitectura
- **Inspiración:** kunalshah017/arbiter — patrón destilado, NO se copia su stack.
- **Relacionados:** ADR-0001 (`CausalHypothesis` reificada — referenciada pero aún
  no materializada en `src/data/db/schema.ts`), ADR-0004 (lazo Beta-Binomial
  post-hoc), ADR-0005 (memoria episódica). Este plan es **ortogonal** a ADR-0004:
  aquél aprende ENTRE sesiones y nunca toca la ruta de decisión; éste valida
  DENTRO de una sola decisión, antes de mostrarla.

================================================================================
## 0. CONTEXTO — cómo fluye HOY un diagnóstico (anclado en el repo)
================================================================================

Camino real, de DTC a pantalla, citando archivos:

1. **Lectura.** `src/domain/usecases/read-trouble-codes.ts` → `IOBDRepository.readTroubleCodes()`
   (mode 03). El parser `src/core/utils/dtcParser.ts::parseDtcResponse()` arma
   `ParsedDtc` y asigna `severity` por rango de código en `classifySeverity()`
   (única "clasificación determinística por SAE J2012" que existe hoy).
2. **Interpretación.** `src/domain/usecases/interpret-with-qvac.ts` →
   `src/data/repositories/llm.repository.impl.ts::interpret()`. Ahí se arma la
   query de retrieval (`buildRetrievalQuery`), se expande por SKOS con
   `retrievalContext(dtc)` de `src/data/knowledge/obd-ontology.ts`, y se recupera
   conocimiento vía `src/data/datasources/shimi.datasource.ts::search()` —
   pipeline de 4 capas: claudeKnowledge → `shimiTree` (jerárquico por confianza)
   → `qvac-rag.datasource.ts` (vector, EmbeddingGemma 300M) → merge. Se suman
   chunks de Hypercore y patrones condicionales (`pattern-evaluator.ts`).
3. **Generación.** `src/data/datasources/qvac-sdk.datasource.ts::interpret()`
   manda todo a CARpsy (Qwen3-0.6B) y devuelve **texto libre** (sólo
   `stripThinkingTokens`). El chat va por `chat()` con `searchWithProvenance`
   (verified vs unverified).
4. **Ruteo.** `src/domain/usecases/query-router.ts::classifyQuery()` es un
   clasificador binario por regex (diagnostic→CARpsy / general→Claude);
   `multi-agent-chat.ts` orquesta el switch + fallback + eval de calidad async.

**Resumen (3-4 líneas):** Hoy el sistema lee DTCs, los clasifica por rango,
recupera conocimiento curado por ontología SKOS + vector + patrones, y deja que
un 0.6B emita **prosa libre sin validar contra los datos reales del vehículo**.
No hay clasificación de contexto del vehículo, no hay salida estructurada, no hay
gate de validación, no hay reintento acotado. El "router multi-agente" es, en
rigor, un clasificador de una dimensión (on-device vs nube).

**Brechas frente al patrón arbiter (honestas):**
- `faultClass` y `CausalHypothesis` se citan en ADR-0001/0004 pero **NO existen en
  `src/data/db/schema.ts`** (sólo `sessions`, `trouble_codes`, `vehicles`,
  `pid_readings`). El "DTC→faultClass por SAE J2012" hoy vive disperso entre
  `dtcParser.classifySeverity()` (rangos) y `DTC_TO_CONCEPT` / `conceptForDtc()`
  (ontología). Hay materia prima determinística; falta consolidarla.
- **Freeze frame (mode 02), readiness monitors (mode 01 PID 01) y Mode $06 NO
  están implementados.** `src/core/constants/pids.ts` sólo define PIDs mode 01
  live; `elm327.datasource.ts`/`obdParser.ts` no emiten 02/06/0101. Toda regla de
  gate que dependa de esos datos arrastra una dependencia de hardware nueva.
- La salida es texto libre; no hay JSON con schema en ninguna capa.

================================================================================
## 1. PATRONES A INCORPORAR — qué se modifica, dónde, schema/reglas, scope/riesgo
================================================================================

Notación de riesgo: low = aislado, testeable con tablas, sin hardware; med =
toca prompt/parse del 0.6B o nuevas tablas; high = depende de comandos ELM327
nuevos o de decodificación no determinista del LLM.

--------------------------------------------------------------------------------
### Patrón 1 — Closed-loop: LLM propone, GATE determinístico valida, reintenta
--------------------------------------------------------------------------------
**Qué se modifica.** Se inserta una etapa de validación entre la generación de
CARpsy y la entrega a UI. CARpsy ya no produce el resultado final: produce una
**hipótesis estructurada candidata** que un gate puro acepta/rechaza contra datos
reales (DTCs, params live, faultClass). Si rechaza, devuelve `rejection_reasons`
y se reintenta con esos motivos inyectados en el prompt.

**Archivos.**
- NUEVO `src/domain/usecases/closed-loop-diagnose.ts` — orquestador del lazo
  (propose → gate → [retry|finalize]). Función pura sobre dependencias inyectadas,
  estilo `decideDiagnosticAction()` ya adoptado en ADR-0004.
- NUEVO `src/domain/services/diagnostic-gate.ts` — `runGate(hypothesis, ctx):
  GateResult` puro y determinístico (sin LLM, sin red).
- MODIFICA `src/domain/usecases/interpret-with-qvac.ts` — pasa a delegar en el
  orquestador en lugar de llamar al repo directo.
- MODIFICA `src/data/repositories/llm.repository.impl.ts::interpret()` — expone un
  modo "propose structured" (ver Patrón 4) reusando el retrieval ya existente.

**Reglas/schema.** El gate consume la `DiagnosticContext` (DTCs + snapshot live +
faultClass derivada). No requiere tablas nuevas en su forma mínima (opera en
memoria sobre lo ya leído). Ver §2 para el catálogo de reglas.

**Scope/riesgo: MED.** El lazo en sí es código puro de bajo riesgo; el riesgo está
en (a) que CARpsy produzca estructura parseable (Patrón 4) y (b) acotar latencia
on-device (Patrón 6). Dependencias: Patrón 4 (salida estructurada) y Patrón 5
(faultClass determinística) son **prerequisito duro**.

--------------------------------------------------------------------------------
### Patrón 2 — Roles separados: Clasificador → Generador → Advisor (sólo si gate rechaza)
--------------------------------------------------------------------------------
**Qué se modifica.** Hoy `query-router.ts` es un único clasificador binario. Se
introduce un pipeline de roles con **prompts chicos y especializados** (mejor para
0.6B que un mega-prompt):
- **Clasificador de contexto** (Patrón 3) — determinístico, sin LLM.
- **Generador** — CARpsy propone hipótesis estructurada (prompt mínimo, sólo
  faultClass + señales + KB top-k).
- **Advisor** — CARpsy SÓLO se reinvoca si el gate rechaza, con un prompt distinto
  y más chico centrado en `rejection_reasons` ("tu hipótesis X falló por Y;
  reconsiderá").

**Archivos.**
- NUEVO `src/domain/services/context-classifier.ts` (Patrón 3).
- MODIFICA `src/data/datasources/qvac-sdk.datasource.ts` — separar `SYSTEM_PROMPT`
  monolítico en prompts por rol (`PROMPT_GENERATE`, `PROMPT_ADVISE`); ambos mucho
  más cortos que el actual `buildUserMessage`.
- El `query-router.ts` actual (CARpsy vs Claude) se **conserva intacto** — es otra
  dimensión (on-device vs nube) y no se toca.

**Reglas/schema.** Ninguna tabla nueva. El contrato entre roles es el JSON del
Patrón 4.

**Scope/riesgo: MED.** Riesgo de regresión de calidad: partir el prompt puede
bajar la coherencia del 0.6B si los prompts quedan mal calibrados. Mitigación:
A/B contra el prompt actual usando `scripts/eval-carpsy.js` (ya existe el harness
de eval). Dependencia: Patrón 4.

--------------------------------------------------------------------------------
### Patrón 3 — Clasificar contexto del vehículo ANTES de diagnosticar
--------------------------------------------------------------------------------
**Qué se modifica.** Antes de recuperar/generar, se computa un `VehicleState`
determinístico que condiciona retrieval y prompt:
- `severity` agregada (de `dtcParser.classifySeverity`, ya existe).
- `runs` / `noStart` (heurística sobre RPM live: RPM>0 ⇒ arranca).
- `readinessComplete` (requiere mode 01 PID 01 — ver dependencia hardware).
- `hasFreezeFrame` (requiere mode 02 — ver dependencia hardware).
- presencia de alertas live (`param.alert`, ya existe en `ObdParameterSnapshot`).

Este estado: (a) ajusta el `topK`/expansión SKOS del retrieval en
`llm.repository.impl.ts`, (b) entra al prompt del generador, (c) alimenta reglas
del gate (§2).

**Archivos.**
- NUEVO `src/domain/services/context-classifier.ts::classifyVehicleState(snapshot,
  dtcs): VehicleState`. Puro, testeable con tablas (patrón ya adoptado).
- NUEVO tipo en `src/domain/entities/` (p.ej. `diagnostic-context.ts`).
- MODIFICA `llm.repository.impl.ts` — usa `VehicleState` para parametrizar
  retrieval.
- (Opcional) MODIFICA `src/core/constants/pids.ts` si se agrega readiness/freeze.

**Reglas/schema.** Las heurísticas de estado son reglas puras. `readinessComplete`
y `hasFreezeFrame` quedan en `false` mientras no haya soporte de hardware
(degradación con gracia, igual que el resto del sistema).

**Scope/riesgo: LOW** para la parte basada en datos que YA se leen (RPM,
severidad, alertas). **MED→HIGH** para readiness/freeze (dependencia de comandos
ELM327 nuevos — ver Patrón candidato y §ADRs). Recomendación: entregar el
clasificador en su versión "datos existentes" primero; readiness/freeze detrás de
feature flag.

--------------------------------------------------------------------------------
### Patrón 4 — Salida estructurada estricta (JSON con schema fijo)
--------------------------------------------------------------------------------
**Qué se modifica.** CARpsy deja de emitir prosa libre para el camino diagnóstico
y emite un objeto fijo. La prosa para UI se deriva DESPUÉS del gate (render
determinístico o una segunda pasada corta).

Schema propuesto (contrato único entre Generador, Gate y UI):
```
DiagnosticHypothesis {
  hypothesis: string;                  // causa raíz candidata, 1 frase
  fault_class: string;                 // de §5 (determinística, NO la elige el LLM)
  supporting_signals: string[];        // señales reales citadas (DTC/param)
  contradicting_signals: string[];     // señales que la contradicen
  confidence: number;                  // 0..1
  recommended_checks: string[];        // pasos concretos
  gate_passed: boolean;                // lo set-ea el GATE, no el LLM
  rejection_reasons: string[];         // lo set-ea el GATE
}
```

**Archivos.**
- NUEVO `src/domain/entities/diagnostic-hypothesis.ts` — tipo + validador de forma.
- MODIFICA `src/data/datasources/qvac-sdk.datasource.ts` — nuevo
  `proposeStructured()` que pide JSON y lo parsea con **parse-tolerante + repair**
  (extraer primer bloque `{...}`, reintentar una vez con instrucción de formato).
  Idealmente decodificación con gramática/JSON-grammar si el SDK QVAC lo soporta;
  verificar en https://docs.expo.dev/versions/v56.0.0/ y en la API del SDK antes
  de asumirlo.
- MODIFICA `i-llm.repository.ts` / `llm.repository.impl.ts` — nueva firma que
  devuelve `DiagnosticHypothesis` en vez de `LLMInterpretationResult` para el
  camino diagnóstico.

**Reglas/schema.** `fault_class` y `gate_passed`/`rejection_reasons` **NO** son
campos que el LLM rellena libremente: `fault_class` se deriva determinísticamente
(§5) y se INYECTA; los de gate los set-ea el gate. El LLM sólo aporta hypothesis,
signals, confidence, checks.

**Scope/riesgo: HIGH.** Es el cuello de botella real: forzar JSON válido en un
Qwn3-0.6B es frágil. Mitigaciones: schema chico, few-shot en el prompt, grammar
decoding si está disponible, parse-repair con 1 reintento, y **fallback honesto**
a texto libre + gate-skip si tras N intentos no hay JSON (nunca romper la UX).
Dependencia: ninguna previa, pero habilita a 1, 2, 6.

--------------------------------------------------------------------------------
### Patrón 5 — Motor determinístico hace el trabajo pesado; LLM sólo razona
--------------------------------------------------------------------------------
**Qué se modifica.** Maximizar lo resuelto por lógica/SQLite y minimizar lo
delegado al LLM. Concretamente consolidar el mapeo **DTC→faultClass** hoy disperso:
- `dtcParser.classifySeverity()` (rangos por SAE J2012) +
- `DTC_TO_CONCEPT` / `conceptForDtc()` / `ancestors()` (closure SKOS de
  `obd-ontology.ts`, que es el análogo funcional de `subClassOf`)
en una función única `faultClassFor(dtc): FaultClass` y su closure.

**Archivos.**
- NUEVO `src/domain/services/fault-class.ts` — `faultClassFor()` +
  `faultClassClosure()` sobre la ontología existente. Puro, sin LLM.
- (Futuro, si se materializa ADR-0001) MIGRACIÓN en `src/data/db/schema.ts` para
  una tabla `causal_hypothesis(fault_class, effect_dtc, ...)` y resolver el closure
  por SQL. **Hoy NO es necesaria**: la ontología in-memory ya da el closure y
  evita una migración Drizzle prematura.

**Reglas/schema.** `FaultClass` = nodo canónico SKOS del DTC + su cadena de
ancestros. El closure `subClassOf` se computa con `ancestors()` ya existente. No
se inventa stack nuevo; se nombra y centraliza lo que ya hay.

**Scope/riesgo: LOW.** Es refactor/consolidación de lógica existente, 100%
testeable con tablas, sin hardware ni LLM. Es además el prerequisito más barato
del gate. **Hacerlo primero.**

--------------------------------------------------------------------------------
### Patrón 6 — Iteración acotada: techo duro de reintentos + fallback honesto
--------------------------------------------------------------------------------
**Qué se modifica.** El lazo del Patrón 1 lleva `MAX_RETRIES = 2` (techo duro,
crítico por batería/latencia en un 0.6B on-device). Tras agotar reintentos sin
pasar el gate, se entrega un resultado honesto: la mejor hipótesis marcada como
**no confirmada** + "no pude confirmar con los datos disponibles, revisá X"
(X = `recommended_checks` o las señales faltantes que el gate reportó).

**Archivos.**
- MODIFICA `src/domain/usecases/closed-loop-diagnose.ts` — contador, corte, y
  ensamblado del fallback.
- Reusar `audit-log.ts` (`src/core/utils/audit-log.ts`) para loguear cada
  iteración del lazo con clock inyectado (patrón AuditLogger ya adoptado en
  ADR-0004) → trazabilidad de cuántas vueltas dio el gate.

**Reglas/schema.** Constante de techo + política de fallback. Sin tablas nuevas
(salvo si se persiste el receipt del lazo, opcional).

**Scope/riesgo: LOW.** Lógica de control simple. El valor está en la disciplina:
sin techo, el lazo puede drenar batería. Dependencia: Patrón 1.

--------------------------------------------------------------------------------
### Patrón 7 — Manifiesto del skill con inputs/outputs/capabilities/limits honestos
--------------------------------------------------------------------------------
**Qué se modifica.** Para la submission QVAC, declarar explícitamente qué hace y
qué NO hace el skill de diagnóstico closed-loop.

**Archivos.**
- MODIFICA `qvac/addons.manifest.json` (ya existe el manifest de addons) — agregar
  o extender la entrada del skill con: inputs (DTCs, snapshot live, vehicleCtx),
  outputs (`DiagnosticHypothesis`), capabilities (gate determinístico, retrieval
  on-device, retry acotado), **limits honestos** (no lee freeze frame/mode06 aún;
  el 0.6B puede fallar el JSON y caer a texto; sin red).
- NUEVO `docs/skills/diagnostic-closed-loop.md` — manifiesto legible humano,
  alineado con `docs/INTELLIGENCE.md` y `docs/QA-agent-intelligence.md`.

**Scope/riesgo: LOW.** Documentación + un JSON. Riesgo nulo salvo
sobre-prometer; el énfasis es honestidad de límites. Dependencia: refleja el
estado real tras implementar 1-6.

================================================================================
## 2. REGLAS DETERMINÍSTICAS CANDIDATAS PARA EL GATE (catálogo concreto)
================================================================================

Cada regla es pura: `(hypothesis, ctx) -> ok | reason`. El gate corre TODAS y
acumula `rejection_reasons`. Marcado por dependencia de datos.

**Disponibles HOY (sólo lógica + datos ya leídos) — implementar primero:**
- **G1 DTC↔faultClass coherente.** La `fault_class` que afirma soportar la
  hipótesis debe pertenecer al closure SKOS de algún DTC activo
  (`faultClassClosure(dtc)`, §5). Si la hipótesis habla de catalizador pero no hay
  DTC del closure de `catalyst`/`emissions`, rechazar.
- **G2 Señales citadas existen.** Cada item de `supporting_signals` debe
  referenciar un DTC activo real o un PID presente en el snapshot. Señal inventada
  ⇒ rechazo (anti-alucinación, el chequeo de mayor valor).
- **G3 Coherencia de severidad.** Si todos los DTCs son `info` (B/C/U) pero la
  hipótesis afirma falla `critical` de powertrain, marcar contradicción.
- **G4 Coherencia con alertas live.** Si la hipótesis es "sobrecalentamiento" pero
  `COOLANT_TEMP.alert` es null y el valor < umbral (`pids.ts`), contradicción.
  Análogo para VOLTAGE, FUEL_TRIM (lean/rich) vs hipótesis de mezcla.
- **G5 No-start vs RPM.** Si la hipótesis asume motor en marcha pero el estado es
  `noStart` (RPM=0), o viceversa, rechazar.
- **G6 Confidence piso.** `confidence < τ` (p.ej. 0.35) con DTCs presentes ⇒ pedir
  reconsideración (no rechazo duro, señal blanda).

**Requieren hardware nuevo (detrás de feature flag; ver §ADRs):**
- **G7 Readiness/Mode $06.** Si la hipótesis depende de un monitor cuyo readiness
  está incompleto, bajar confidence / pedir "completar drive cycle". Requiere
  mode 01 PID 01 (readiness) y opcionalmente mode 06 (resultados de test).
- **G8 Freeze frame.** Validar la hipótesis contra las condiciones congeladas
  (RPM/carga/temp al momento del DTC, mode 02). Requiere captura de freeze frame.

**Nota honesta:** G1-G6 cubren el grueso del valor anti-alucinación con CERO
dependencia de hardware nuevo. G7-G8 son incrementales y NO deben bloquear el MVP
del gate.

================================================================================
## 3. FASES DE IMPLEMENTACIÓN (ordenadas por dependencia)
================================================================================

Cada fase es desplegable sola y de-riskea la siguiente (estilo ADR-0004/0005).

- **Fase 0 — `faultClassFor()` determinística (Patrón 5).** Consolidar
  `dtcParser` + `obd-ontology` en `src/domain/services/fault-class.ts`. Sin cambio
  de comportamiento; pura ganancia de testabilidad. **Prerequisito de todo.**
  Riesgo LOW.
- **Fase 1 — Clasificador de contexto, versión "datos existentes" (Patrón 3).**
  `classifyVehicleState()` sobre RPM/severidad/alertas. Aún sin gate. Riesgo LOW.
- **Fase 2 — Salida estructurada (Patrón 4).** `proposeStructured()` en
  `qvac-sdk.datasource.ts` + entidad + parse-repair + fallback a texto. Es el hito
  más riesgoso; aislarlo. Riesgo HIGH. → amerita ADR.
- **Fase 3 — Gate G1-G6 + lazo acotado (Patrones 1, 6).**
  `diagnostic-gate.ts` + `closed-loop-diagnose.ts` con `MAX_RETRIES=2` y fallback
  honesto, logueando vía `audit-log.ts`. Riesgo MED. → amerita ADR.
- **Fase 4 — Roles separados Generador/Advisor (Patrón 2).** Partir prompts;
  A/B con `scripts/eval-carpsy.js`. Riesgo MED.
- **Fase 5 — Manifiesto del skill (Patrón 7).** `qvac/addons.manifest.json` +
  `docs/skills/...`. Riesgo LOW.
- **Fase 6 (opcional, hardware) — Readiness/Freeze frame (G7-G8).** Comandos
  ELM327 nuevos (mode 01 PID 01, mode 02, mode 06) en `elm327.datasource.ts` +
  parsers + PIDs. Detrás de feature flag. Riesgo HIGH. → amerita ADR propio.

================================================================================
## 4. ADRs A ABRIR (sugerencias — ADR-0005 YA está tomado por memoria episódica)
================================================================================

- **ADR-0006 — "Closed-loop diagnóstico con gate determinístico"** (Fases 2-4).
  Decisión central: insertar validación determinística en la ruta de decisión,
  salida estructurada estricta, reintento acotado. Debe explicitar la relación con
  ADR-0004 (gate IN-path vs learning loop POST-path; el gate puede consumir el
  ranking del re-ranker pero no escribe) y con ADR-0001 (faultClass: se usa la
  ontología in-memory, se difiere la tabla `causal_hypothesis`).
- **ADR-0008 — "Captura de freeze frame y readiness (mode 01-PID-01 / mode 02;
  mode 06 fuera)"** (Fase 6). NOTA: este plan reservaba el número 0007 para esta
  decisión, pero 0007 terminó usándose para firma/rotación de claves; el ADR de
  hardware es **0008** ([0008-readiness-freezeframe-capture.md](0008-readiness-freezeframe-capture.md)). Decisión de
  hardware/protocolo separada porque arrastra riesgo de compatibilidad ELM327 y latencia
  de lectura; habilita G7-G8. Resuelve los campos `freezeFrame.*` que el `caseSignature`
  del ADR-0004 ya asume mediante degradación con gracia en `bucket()`, no recolectándolos
  a las apuradas. Prioridad: readiness primero (anti-fraude, autos reseteados), freeze
  frame después; mode 06 fuera. Reordenado y detallado en PLAN-002 (M6/M7).

================================================================================
## 5. EXPLÍCITAMENTE FUERA DE ALCANCE
================================================================================

- **Todo el stack server-side de arbiter** (su backend, su orquestación cloud, su
  base de datos remota, su modelo de despliegue). OBDient es offline-first; sólo se
  destila el *patrón* closed-loop, no su infraestructura.
- **Reentrenar o fine-tunear CARpsy** para mejorar el JSON (descartado por las
  mismas razones que ADR-0004 §Alternativas: rompe reproducibilidad, caro
  on-device).
- **El lazo de aprendizaje estadístico** (ADR-0004) y la **memoria episódica**
  (ADR-0005): este plan los referencia y compone, pero no los re-deriva ni los
  modifica.
- **Materializar las tablas `causal_hypothesis`/`context_stats` de ADR-0001/0004**
  como prerequisito del gate: se difiere; la ontología in-memory alcanza para
  G1-G6.
- **Federación / Acurast / TEE:** fuera de alcance, como en ADR-0004/0005.

================================================================================
## 6. RIESGO TRANSVERSAL (resumen honesto)
================================================================================

El único riesgo HIGH real es el Patrón 4 (JSON estable desde un 0.6B). Si esa
pieza no rinde, el gate sigue siendo útil operando sobre una extracción parcial
(regex de señales/faultClass desde el texto libre) — peor pero no nulo. Todo lo
demás (faultClass, clasificador de contexto, reglas G1-G6, lazo acotado) es
código puro, determinístico y testeable con tablas, con riesgo de regresión
controlado por degradación con gracia, exactamente como el resto del sistema ya
hace cuando el RAG o el modelo no están listos.
