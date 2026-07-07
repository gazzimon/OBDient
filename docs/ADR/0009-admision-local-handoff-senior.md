# ADR-0009: Admisión local → handoff senior — el junior entrevista, el senior conduce, la sesión persiste

- **Estado:** Propuesto
- **Fecha:** 2026-07-06
- **Deciders:** Gustavo (gazzimon)
- **Relacionados:** ADR-0006 (núcleo determinístico — el brief se ensambla con su
  `DiagnosticContext` y su frontera "el núcleo decide, el sampler narra" se extiende al
  handoff), ADR-0006-A (síntomas reportados — la entrevista de admisión es su superficie
  de captura), ADR-0002 (currículo del senior — esta base de sesiones es el tráfico
  real que 0002 asumía como futuro), ADR-0004 (learning loop — los `outcomes` de esta
  base alimentan sus conteos Beta-Binomial), ADR-0005 (memoria episódica — la sesión
  persistida es su materia prima), PLAN-002 (el gate G1-G6 pasa a validar el brief
  como pre-flight de la llamada senior)
- **Repos afectados:** `gazzimon/OBDient` (`domain/entities`, `domain/services`,
  `domain/usecases`, `data/datasources/claude-api`, `data/db/schema.ts`,
  `presentation/viewmodels`, `__tests__`)

---

## Contexto y problema

Hoy el chat tiene dos rutas fijas decididas mensaje a mensaje por `query-router.ts`:
lo diagnóstico va a CARpsy (0.6B on-device) y lo general a Claude. Consecuencias:

1. **CARpsy es el diagnosticador final** de todos los casos con datos de vehículo,
   y un 0.6B no tiene la profundidad de un modelo senior para conducir un diagnóstico
   completo hasta una solución accionable.
2. **No existe admisión.** Nadie recolecta sistemáticamente qué auto es, año, ni el
   relato del usuario. Si el VIN no decodifica, el vehículo queda `Unknown` para
   siempre; el síntoma humano no se captura estructurado (hueco que ADR-0006-A modela
   pero que aún no tiene superficie).
3. **La conversación se evapora.** Nada de lo diagnosticado ni de lo resuelto se
   persiste como caso: el learning loop de ADR-0004 y el currículo del senior de
   ADR-0002 asumen un corpus de sesiones que hoy no se acumula.

La pregunta de diseño: ¿cómo usar al senior (Claude) para el diagnóstico profundo sin
regalarle el trabajo barato (la entrevista), sin mandar datos que no deben viajar, sin
pagar llamadas basura, y capturando cada caso para que el sistema aprenda?

## Drivers de decisión

- **Una buena llamada.** El senior se invoca una sola vez por caso, con un brief
  completo — nunca "en frío" ni con contexto a medias. La llamada cara se gana.
- **Contrato de datos explícito:** los datos del vehículo **sí viajan** (marca,
  modelo, año, motor, DTCs, snapshot live, síntomas); **nunca viajan** el nombre del
  usuario ni el VIN. Redacción determinística, no promesa.
- **Frontera de ADR-0006 extendida al handoff:** el modelo local entrevista y narra;
  el brief lo **ensambla código determinístico** desde datos confirmados. La prosa
  libre del 0.6B no entra al contexto del senior.
- **Degradación con gracia:** sin red, sin API key o con checklist incompleta, el
  junior sigue solo (comportamiento actual). Nadie se queda sin respuesta.
- **Capturar ahora, aprender después:** la persistencia es append-only y post-hoc;
  el aprendizaje nunca entra al hot path (invariante de ADR-0004).

## Decisión

Adoptamos un pipeline de sesión en cuatro etapas con una **máquina de estados por
sesión** que reemplaza la clasificación mensaje-a-mensaje para el flujo diagnóstico:

```
intake (CARpsy) → brief (determinístico) → senior (Claude, conduce hasta el fin) → outcome
        │                    │                          │                             │
        └────────────────────┴──── persistencia append-only (briefs/turns/outcomes) ──┘
```

### 1. Admisión: el junior entrevista, la checklist decide

CARpsy conduce la entrevista de admisión **generando las preguntas** (rol nuevo
`Entrevistador`, prompt chico y especializado): qué auto es, año, qué le pasa, desde
cuándo. Debajo corre una **checklist determinística** (`briefReadiness()`, pura) que
decide cuándo la admisión está completa — el LLM decide *cómo* preguntar; la checklist
decide *cuándo parar*. Lo respondido se estructura con las piezas ya diseñadas:
parser determinístico + confirmación para marca/modelo/año, picker de síntomas de
ADR-0006-A para el relato. Si el 0.6B no está disponible, la entrevista degrada a
plantillas fijas — la checklist es la misma.

**Checklist de handoff (G0).** El brief está listo cuando hay:
- **Identidad:** marca + modelo + año (del VIN decodificado o corregidos por el
  usuario; prioridad: VIN > corrección manual > desconocido), y
- **Estado del vehículo:** al menos una evidencia OBD real — DTCs activos, o snapshot
  live con `vehicleState` clasificable (ADR-0006 / PLAN-002 M1). Los síntomas
  reportados **enriquecen** el brief pero no sustituyen esta evidencia: la llamada
  senior es solo para casos con datos del estado del vehículo.

**Suficiencia de entrevista (encima del G0 duro).** Cumplir G0 no dispara el handoff
por sí solo — sin esto, un VIN decodificado + DTCs producían la llamada senior en el
primer mensaje y el junior nunca entrevistaba. Antes de gastar la llamada, el junior
además debe: (a) tener **al menos un síntoma** capturado — la pregunta se guía por los
`faultClass` de los DTCs activos vía las aristas `manifestsAs` (ADR-0006-A: "los códigos
sugieren X, ¿notás alguno de estos?") — y (b) haber hecho **al menos un intercambio de
refinamiento** (desde cuándo, frío/caliente, condiciones) cuando el síntoma vino en el
primer mensaje. Tope de insistencia: al agotar las preguntas (4), si el G0 duro se
cumple se hace el handoff con lo que haya — una llamada decente vale más que ninguna;
si no se cumple, degrada al junior. Sin senior configurado la entrevista se saltea por
completo (no hay llamada que refinar).

### 2. El brief: ensamblado determinístico, redactado determinísticamente

La salida de la admisión es un `DiagnosticBrief` tipado que un renderer puro convierte
en el prompt del senior. Composición: identidad (sin VIN), síntomas confirmados
(`SymptomId` + descripción del catálogo), DTCs con su `faultClass` (M0), resumen del
snapshot live con alertas, `vehicleState`, kilometraje, y qué preguntó/respondió la
admisión. **El 0.6B no redacta el brief** — si lo hiciera, sus alucinaciones se
inyectarían directo al contexto del senior. El brief es reproducible: mismo estado de
sesión ⇒ mismo prompt.

**Redacción de PII (`redactBrief()`, pura):** se eliminan el VIN (campo y patrón
de 17 caracteres en texto libre), patentes y el nombre del usuario (que nunca se
incluye por construcción). El texto crudo del usuario queda **local** en el snapshot
de sesión (auditable, ADR-0006-A); al senior viaja la versión redactada.

### 3. El senior conduce hasta el fin

Con el brief validado (el gate G1-G6 de PLAN-002, cuando exista, corre como
**pre-flight**: un brief incoherente no viaja), se hace **la** llamada a Claude. La
primera respuesta se guarda y desde ahí **Claude conduce la conversación hasta el
cierre de la sesión**: cada turno posterior del usuario va al senior con el hilo
completo. El junior no vuelve a intervenir en esa sesión salvo caída de red
(fallback local explícito, marcado en la UI como degradado).

### 4. La base de casos: toda conversación alimenta el aprendizaje

Tres tablas Drizzle append-only (extienden el patrón de `storage.datasource.ts`):

- `briefs` — la foto estructurada del caso al momento del handoff (identidad
  redactada, DTCs, faultClass, síntomas, vehicleState, snapshot resumido).
- `conversation_turns` — cada turno (rol: user/junior/senior, contenido, timestamp,
  sessionId). La entrevista y la conversación senior completas.
- `outcomes` — el cierre del caso: "¿qué era? ¿qué lo arregló?" (el outcome-capture
  UX4 de PLAN-002 §5 / ADR-0004 Fase 0), capturado al final de la sesión o en una
  visita posterior.

De esta base **leen** (post-hoc, nunca en el hot path): los conteos Beta-Binomial de
ADR-0004 (prior jerárquico de ADR-0006), la recalibración de pesos `manifestsAs` de
ADR-0006-A Fase 4, la ingesta de respuestas del senior como conocimiento no-verificado
al RAG (pipeline `claude-knowledge` existente), y el currículo del senior de ADR-0002.
Este ADR **crea la fuente**; los consumidores ya están diseñados en sus ADRs.

### Relación con la premisa de privacidad existente

`query-router.ts` mantenía los datos del vehículo on-device enrutando lo diagnóstico a
CARpsy. Este ADR **modifica esa premisa deliberadamente**: los datos del vehículo sí
viajan al senior — con el contrato de redacción de §2 (sin VIN, sin identidad del
usuario) y solo tras checklist completa. No contradice el rechazo de ADR-0003 a la
federación P2P de consultas vivas: aquello era exponer datos a *peers anónimos*; esto
es una llamada al proveedor cloud que la app ya usaba para la ruta `general`, ahora
con contrato explícito. El router actual se conserva para mensajes fuera de una
sesión diagnóstica.

## Plan de implementación por fases

- **Fase 0 — Núcleo puro del brief.** `DiagnosticBrief` + `briefReadiness()` (G0) +
  ensamblador/renderer + `redactBrief()` + `classifyVehicleState()` (PLAN-002 M1) +
  taxonomía de síntomas (ADR-0006-A Fase 0). Todo puro, table-tested, cero cambio de
  comportamiento. Riesgo LOW.
- **Fase 1 — Captura en chat.** Parser de identidad + confirmación; picker de síntomas
  (ADR-0006-A Fase 1); rol `Entrevistador` en CARpsy con fallback a plantillas;
  máquina de estados de sesión en el ViewModel. Riesgo MED (UX + calidad del 0.6B).
- **Fase 2 — Handoff y conversación senior.** Modo conversación con historial en
  `claude-api.datasource.ts`; la llamada única con el brief; persistencia de la
  respuesta; turnos siguientes al senior. Riesgo MED.
- **Fase 3 — Persistencia.** Tablas `briefs` / `conversation_turns` / `outcomes` +
  escritura append-only desde la máquina de estados + captura de outcome al cierre.
  Riesgo LOW (patrón Drizzle existente).
- **Fase 4 — Consumidores de aprendizaje.** Post-MVP; ya diseñados en
  0002/0004/0006-A. Este ADR solo garantiza que la fuente exista.

## Consecuencias

### Positivas
- El diagnóstico profundo lo hace un modelo senior con un caso completo, no un 0.6B.
- La llamada cara se paga una vez y con munición: brief completo, validado, redactado.
- Cada caso queda persistido — nace el corpus que 0002/0004/0005 asumían.
- La admisión estructurada resuelve de paso la captura de identidad (VIN fallido) y
  de síntomas (ADR-0006-A) con una sola superficie de UX.
- Frontera determinística intacta y extendida: entrevista (LLM) / checklist y brief
  (código) / narrativa senior (LLM) / persistencia y aprendizaje (código).

### Negativas / costos
- Costo por sesión diagnóstica (mitigado: una llamada, gateada por G0 y pre-flight).
- El flujo diagnóstico deja de ser 100% offline en su camino preferido (mitigado:
  fallback local completo; el contrato de redacción acota qué viaja).
- Máquina de estados de sesión = más complejidad en el ViewModel que el router
  binario actual.
- La calidad de la entrevista depende del 0.6B (mitigado: checklist determinística
  + plantillas de fallback; la completitud nunca depende del LLM).

### Riesgos y mitigaciones
- **PII en texto libre del usuario** (patentes, nombres, direcciones) → `redactBrief()`
  determinístico sobre patrones conocidos + el texto crudo nunca sale del snapshot
  local; al senior viaja la versión redactada.
- **El 0.6B entrevista mal** (pregunta lo ya sabido, loops) → la checklist corta: cada
  pregunta del Entrevistador se genera *condicionada a los campos faltantes*, y con
  N intentos fallidos por campo degrada a plantilla fija.
- **Handoff prematuro o brief basura** → G0 exige identidad + evidencia OBD real; el
  gate G1-G6 (PLAN-002 M3) se enchufa como pre-flight cuando exista.
- **Deriva de costos** → una llamada por sesión como invariante; los turnos siguientes
  reusan el hilo (sin re-inyectar el brief); tope de turnos senior por sesión,
  configurable.

## Alternativas consideradas

- **Claude desde el primer mensaje (sin admisión local):** descartado. Paga tokens por
  la parte barata (la entrevista), manda datos antes de saber si hay caso, y deja al
  junior sin rol — exactamente lo contrario de "una buena llamada".
- **Que el 0.6B redacte el brief en prosa:** descartado. Inyecta alucinaciones del
  junior al contexto del senior sin control; el ensamblado determinístico es
  reproducible y auditable (misma razón que la frontera de ADR-0006).
- **Junior y senior alternando durante toda la conversación (co-pilotaje):** descartado
  para el MVP. Duplica complejidad de orquestación y confunde al usuario sobre quién
  responde; la posta única (junior → senior) es más simple y más honesta.
- **Mandar también el VIN para precisión de decodificación:** descartado. El VIN es
  identificador único del vehículo (y proxy del dueño); marca/modelo/año/motor dan al
  senior lo que necesita. Es el mismo criterio del router actual, que ya enviaba solo
  make/model/year en la ruta `general`.
- **Persistir solo el resumen final (no los turnos):** descartado. Los turnos son la
  materia prima del currículo del senior (ADR-0002) y del análisis de dónde falla la
  admisión; el storage es barato y append-only.
