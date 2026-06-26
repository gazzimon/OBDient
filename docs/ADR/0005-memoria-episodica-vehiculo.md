# ADR-0005: Memoria episódica por vehículo

- **Estado:** Propuesto
- **Fecha:** 2026-06-25
- **Deciders:** Gustavo (gazzimon)
- **Relacionados:** ADR-0004 (firma de caso, lazo Beta-Binomial, `vehicleProfile`
  de la Fase 3), ADR-0001 (nodos reificados `CausalHypothesis`)
- **Repos afectados:** `gazzimon/OBDient` (esquema, recall, navegación/UI),
  `gazzimon/CARpsy` (sin cambios de modelo; sólo se lo invoca en consolidación)

---

## Contexto y problema

El ADR-0004 le dio a OBDient **memoria procedural**: un lazo de aprendizaje
Beta-Binomial keyeado por `caseSignature` que aprende *qué hipótesis funciona
para este TIPO de caso* sobre toda la flota. Por diseño, `caseSignature` se
calcula **sin VIN ni PII** —bucketiza año/motor pero borra la identidad del auto
concreto— porque su trabajo es *generalizar* entre casos parecidos:

```typescript
// ADR-0004 — la firma agrega entre autos, NO los distingue
function caseSignature(ctx: DiagnosticContext): string {
  const parts = [
    [...ctx.dtcSet].sort().join('|'),
    ctx.faultClass,
    `${ctx.make}:${ctx.model}:${bucket(ctx.year, 3)}:${ctx.engine}`,
    `coolant:${bucket(ctx.freezeFrame.coolantTemp, 20)}`,
    `load:${bucket(ctx.freezeFrame.engineLoad, 25)}`,
  ];
  return sha256(parts.join('§')); // determinista, sin PII ni VIN
}
```

Eso deja un hueco: OBDient **no recuerda nada de ESTE auto en particular**. Si un
Corsa volvió tres veces por el mismo P0301 y la última vez la causa real fue la
bobina del cilindro 1, esa historia se pierde entre sesiones. El mecánico tiene
que reconstruirla de memoria, y CARpsy arranca cada diagnóstico en frío aunque el
auto sea reincidente. La narrativa de producto —"el diagnóstico que crece con tu
auto", anticipada en la Fase 3 del ADR-0004— necesita una pieza que el lazo
procedural no provee.

En la taxonomía clásica de memoria, OBDient hoy tiene dos de tres patas:

| Tipo | Qué guarda | Dónde vive hoy |
|------|-----------|----------------|
| **Semántica** | Qué se sabe del dominio OBD-II | SHIMI (SKOS, RAG, patrones) |
| **Procedural** | Qué funciona para este *tipo* de caso | ADR-0004 (`contextStats`, Beta-Binomial) |
| **Episódica** | Qué pasó con *este auto* concreto | **— falta —** |

Este ADR llena la tercera: **memoria episódica por vehículo**.

### El bloqueante real: hoy no hay identidad de vehículo estable

Antes de poder recordar "qué pasó con este auto", hay que poder **nombrar al
auto de forma estable**, y hoy no se puede. En
`src/domain/entities/vehicle.ts` la identidad se fabrica así:

```typescript
// createUnknownVehicle() — id efímero, cambia en CADA reconexión
id: `${adapterAddress}-${Date.now()}`,
```

`connect-to-vehicle.ts` consulta `getVehicleByVin()` para no quemar créditos de
Vincario, pero **no reusa el id cacheado**: hace `upsertVehicle()` con el id
fresco. Resultado: la tabla `vehicles` acumula filas duplicadas por VIN y
`sessions.vehicleId` apunta a un id que muere al desconectar. No hay forma de
preguntar "todas las sesiones de este auto". Cualquier memoria episódica se
construye sobre esta clave estable o no se construye.

### Relación con SHIMI y el ADR-0004

La memoria episódica **no compite** con SHIMI ni con el lazo procedural: los
indexa. Comparte deliberadamente la **misma `caseSignature` del ADR-0004** para
que procedural ("lo que funciona para este tipo de falla en la flota") y
episódica ("lo que pasó con este auto") cuelguen de la misma clave y se puedan
cruzar. La episódica agrega exactamente la dimensión —el vehículo— que la firma
omite a propósito.

## Drivers de decisión

- **Offline-first y costo nulo en el hot path.** El recall es la ruta caliente
  (se ejecuta antes de cada respuesta de un 0.6B): tiene que ser SQL puro,
  determinista, sin LLM y sin red.
- **Snapshot crudo = verdad inmutable; resumen = cache desechable.** Todo
  string de memoria tiene que ser reconstruible desde los snapshots de sesión.
- **Reproducibilidad y auditabilidad** al nivel del ADR-0004: clock inyectado,
  `knowledgeVersion` por episodio, nada de `Date.now()` en la verdad.
- **VIN es PII-adjacent.** Identifica unívocamente un auto y, vía registros, a su
  dueño. Nunca debe vivir crudo como clave, en logs ni en URLs/rutas.
- **Multi-vehículo nativo** (caso taller: un teléfono, muchos autos) → keyear por
  vehículo, jamás por usuario.
- **Cold-start sin regresión:** sin episodios, degradar con gracia a semántica +
  priors globales.
- **Reuso del front existente** (Reportes, `SessionCard`, `TroubleCodeCard`,
  detalle `/interpretation/[id]`) y de los patrones ya adoptados (AuditLogger con
  clock, funciones puras testeables).

## Decisión

Adoptamos una **capa de memoria episódica por vehículo** con tres piezas:
(1) una **identidad de vehículo estable y no reversible** (`vehicleKey`), (2) un
**ledger episódico append-only** indexado por `(vehicleKey, caseSignature)`, y
(3) un **card de recall regenerable** (cache desechable). El recall es
determinista y sin LLM; CARpsy sólo interviene en la **consolidación al cerrar
sesión** ("dreaming"). En el front, la historia por auto vive en una **pestaña
dedicada "Garage"**, sin tocar la pantalla de Reportes.

### Identidad estable: `vehicleKey`

Clave determinista, no reversible, derivada del VIN —nunca el VIN crudo— con
fallback para cold-start sin VIN (no todos los adaptadores soportan mode 09):

```typescript
// src/domain/entities/vehicle.ts (nuevo)
export function vehicleKeyFor(vin: string | null, adapterAddress: string): string {
  return vin
    ? sha256('vin:' + normalizeVin(vin))       // estable entre reconexiones
    : sha256('adapter:' + adapterAddress);      // fallback cold-start, degradado
}
// normalizeVin: upper + trim; reusa la validación ISO-3779 de vin.mapper.ts
```

Usamos el mismo primitivo `sha256` que el `caseSignature` del ADR-0004 ya asume.
No es una frontera de seguridad —es una clave local no reversible— así que el VIN
de 17 chars alcanza sin sal; lo que importa es que **el VIN crudo nunca cruza
este límite**: ni a la columna clave, ni a logs, ni a la ruta `garage/[vehicleKey]`.

`vehicleKey` se agrega a la tabla `vehicles` existente como columna lógica de
identidad (no se rompe el `id` actual; se backfillea con el patrón `ALTER TABLE`
idempotente que ya usa `storage.datasource.ts`). `connect-to-vehicle.ts` pasa a
upsertear por `vehicleKey`, eliminando los duplicados por VIN. Esto **es** el
`vehicleProfile` que la Fase 3 del ADR-0004 anticipaba para ajustar priors por
vehículo: ambos lazos —procedural y episódico— comparten esta clave.

### Esquema (Drizzle)

Estilo del repo (`int`/`text`/`real`/`sqliteTable`, mode `timestamp` para fechas
de UI, epoch crudo + clock inyectado para la verdad auditable, como en ADR-0004).

```typescript
// Identidad persistente del vehículo (formaliza el vehicleProfile del ADR-0004 §Fase 3).
export const vehicleProfileTable = sqliteTable('vehicle_profile', {
  vehicleKey: text('vehicle_key').primaryKey(),     // sha256(vin) | sha256(adapter:addr)
  hasVin: int('has_vin', { mode: 'boolean' }).notNull().default(false), // false = fallback degradado
  make: text('make').notNull().default('Unknown'),
  model: text('model').notNull().default('Unknown'),
  year: int('year'),
  engine: text('engine'),
  firstSeenAt: int('first_seen_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: int('last_seen_at', { mode: 'timestamp' }).notNull(),
});

// Ledger episódico: append-only, una fila por evento relevante de ESTE auto.
// Indexa las sesiones (snapshot crudo = verdad) por (vehicleKey, caseSignature).
export const vehicleEpisodeTable = sqliteTable('vehicle_episode', {
  id: text('id').primaryKey(),
  vehicleKey: text('vehicle_key').notNull()
    .references(() => vehicleProfileTable.vehicleKey),
  sessionId: text('session_id').notNull(),          // → snapshot crudo (sessions.id)
  caseSignature: text('case_signature').notNull(),  // MISMA firma del ADR-0004
  kind: text('kind', {
    enum: ['diagnosis', 'repair', 'recurrence', 'cleared'],
  }).notNull(),
  dtcSet: text('dtc_set', { mode: 'json' }).notNull(),     // ['P0301', ...] ordenado
  topHypothesisId: text('top_hypothesis_id'),       // ganadora del re-ranker (ADR-0004)
  outcome: text('outcome', {
    enum: ['confirmed', 'refuted', 'partial', 'unknown'],
  }).notNull().default('unknown'),                  // espejo de outcomeEvidence
  mileage: real('mileage'),
  knowledgeVersion: text('knowledge_version').notNull(),   // receipt → reproducibilidad
  occurredAt: int('occurred_at').notNull(),         // epoch, clock inyectado (no Date.now())
});

// Card de recall: cache DESECHABLE. Reconstruible 100% desde vehicle_episode.
export const vehicleMemoryCardTable = sqliteTable('vehicle_memory_card', {
  vehicleKey: text('vehicle_key').primaryKey()
    .references(() => vehicleProfileTable.vehicleKey),
  cardText: text('card_text').notNull(),            // string comprimido < 512 tokens
  tokenEstimate: int('token_estimate').notNull(),
  generator: text('generator', { enum: ['deterministic', 'carpsy'] })
    .notNull().default('deterministic'),
  sourceHash: text('source_hash').notNull(),        // sha256 del input determinístico
  generatedAt: int('generated_at').notNull(),       // epoch, clock inyectado
});
```

**Jerarquía de verdad, explícita:**

1. **`sessions` (+ `outcomeEvidence` del ADR-0004) = verdad inmutable.** El
   snapshot crudo de cada diagnóstico ya vive ahí (`parametersJson`,
   `messagesJson`, `interpretation`, DTCs en `trouble_codes`). No se duplica.
2. **`vehicle_episode` = índice append-only** que proyecta esos snapshots por
   vehículo. No inventa datos: cada fila referencia un `sessionId` real y se puede
   reconstruir uniendo `sessions ⋈ outcomeEvidence` por `sessionId` + `vehicleKey`.
   Es append-only y nunca se edita.
3. **`vehicle_memory_card` = cache desechable.** Borrarla y regenerarla desde
   `vehicle_episode` es seguro por definición; `sourceHash` detecta staleness.

> **Nota de reconciliación.** El ADR-0004 introduce una tabla `diagnostic_session`
> (con `dtcSet`/`freezeFrame`/`knowledgeVersion`) distinta de la `sessions` actual.
> ADR-0005 referencia *la* sesión canónica por `sessionId`, sea cual sea el nombre
> al que converja el repo; el campo `knowledgeVersion` del episodio se toma de ahí.
> Unificar `sessions` ↔ `diagnostic_session` es trabajo de la Fase 0 del ADR-0004,
> no de este ADR.

### Recall determinístico (hot path, SIN LLM)

Función pura sobre SQL, estilo `decideDiagnosticAction()`: mismo input ⇒ mismo
output, orden total estable, presupuesto de tokens **duro** (CARpsy es 0.6B; la
ventana no banca historia cruda):

```typescript
// SIN LLM, SIN red. Se ejecuta antes de CADA respuesta de CARpsy.
export async function recallVehicleMemory(
  vehicleKey: string,
  currentSignature: string,
  budgetTokens = 480,
): Promise<string> {
  // 1) Episodios de ESTE auto con la MISMA firma → máxima relevancia.
  const exact = db.select().from(vehicleEpisodeTable)
    .where(and(eq(vehicleEpisodeTable.vehicleKey, vehicleKey),
               eq(vehicleEpisodeTable.caseSignature, currentSignature)))
    .orderBy(desc(vehicleEpisodeTable.occurredAt)).limit(4).all();

  // 2) Resto de la historia del auto (otras firmas), priorizando recurrencias
  //    y outcomes resueltos sobre ruido.
  const rest = db.select().from(vehicleEpisodeTable)
    .where(and(eq(vehicleEpisodeTable.vehicleKey, vehicleKey),
               ne(vehicleEpisodeTable.caseSignature, currentSignature)))
    .orderBy(desc(vehicleEpisodeTable.occurredAt)).limit(6).all();

  if (exact.length === 0 && rest.length === 0) return ''; // cold-start → degradar

  // Render determinístico, líneas cortas, desempate estable por id.
  const lines = [
    ...exact.map(renderEpisodeLine),   // "2026-03 P0301 reincidente → bobina cil#1 (confirmado, 84k km)"
    ...rest.map(renderEpisodeLine),    // "2025-11 P0420 → catalizador (parcial, 79k km)"
  ];
  return clampToTokens(lines.join('\n'), budgetTokens); // truncado DURO, nunca excede
}
```

El recall se inyecta en el prompt **detrás** de los priors procedurales y la
recuperación semántica, como un bloque "Historial de este vehículo:". Si devuelve
`''` (cold-start), el ensamblado del prompt simplemente omite el bloque y CARpsy
opera con SHIMI semántico + priors globales del ADR-0004 — **degradación con
gracia, riesgo de regresión cero**.

### Consolidación "dreaming" (post-hoc, único punto con LLM)

Única ventana donde CARpsy toca la memoria, y **fuera del hot path**: al cerrar
la sesión. El builder determinístico es siempre el default y la fuente; el LLM es
un *best-effort* que sólo puede mejorar la prosa del card, nunca bloquear ni
corromper:

```typescript
// Corre al cerrar sesión (post-hoc), NUNCA en el recall.
async function consolidateVehicleMemory(vehicleKey: string, clock: Clock) {
  const base = buildCardDeterministic(vehicleKey);   // SIEMPRE disponible, es la fuente
  let card = base, generator: 'deterministic' | 'carpsy' = 'deterministic';

  if (settings.dreamingEnabled) {
    const dreamt = await carpsy.summarize(base);      // best-effort, puede fallar/timeout
    if (dreamt && estimateTokens(dreamt) <= 512) { card = dreamt; generator = 'carpsy'; }
  }

  await upsertCard({
    vehicleKey, cardText: card, generator,
    tokenEstimate: estimateTokens(card),
    sourceHash: sha256(base),       // de QUÉ evidencia salió → reproducibilidad + staleness
    generatedAt: clock.now(),       // clock inyectado, no Date.now()
  });
}
```

`sourceHash` cierra la reproducibilidad cuando el card lo genera CARpsy: si la
evidencia cambió, el hash no coincide y se regenera; y siempre se puede recomputar
el card determinístico bit a bit desde `vehicle_episode` para auditar qué "soñó"
el modelo. Si `dreamingEnabled` está off, el sistema es 100% determinista.

### Decisión de front: pestaña "Garage" (no dentro de Reportes)

Evalué las dos opciones contra el código real:

- **Reportes hoy** (`src/app/(tabs)/reports.tsx`) es estructuralmente una
  **lista plana**: `container.reportRepo.listSessions(50)` → un `FlatList`
  ordenado por `startedAt desc`, keyeado por `session.id`, con `SessionCard`
  inline y detalle en `/interpretation/[id]`. Su modelo mental es **bitácora
  cronológica de eventos**. `ReportListItem` ya carga `vehicleId`, pero la UI
  lo ignora por completo.
- **Opción A (agrupar Reportes por vehículo):** invierte la arquitectura de
  información de esa pantalla (de cronológica a jerárquica), agrega un nivel de
  navegación y obliga a refactorizar la query y el render para ganar poco. El
  sujeto de la memoria episódica es el **vehículo**, no la sesión; forzarlo como
  agrupación de un log de sesiones es nadar contra la corriente.
- **Opción B/C (pestaña dedicada "Garage", Reportes intacto):** el vehículo pasa
  a ser entidad de primer nivel, que es exactamente lo que pide el caso taller
  multi-auto. Reportes queda como log cronológico global (riesgo de regresión
  cero) y Garage reusa los componentes existentes.

**Decidimos la pestaña dedicada "Garage"** (5ª tab; agregar una más en
`(tabs)/_layout.tsx` es trivial). Es la Opción C híbrida: Garage nuevo + Reportes
sin tocar.

```
(tabs)/garage.tsx               Lista de vehículos por vehicleKey:
                                make/model · último visto · # sesiones ·
                                DTCs abiertos · recurrencias
   └── garage/[vehicleKey].tsx  Detalle del auto:
          • Memory card (vehicle_memory_card)
          • DTCs recurrentes (group by code sobre vehicle_episode)
          • Timeline de sesiones  ← reusa <SessionCard>
                 └── /interpretation/[id]   ← detalle de sesión compartido (sin cambios)
```

Consultas Drizzle que alimentan cada vista (capa nueva, p.ej.
`IVehicleMemoryRepository`, simétrica a `IReportRepository`):

- `listVehicles()` → `vehicle_profile` + counts de `vehicle_episode`/`sessions`.
- `getVehicleHistory(vehicleKey)` → episodios + sesiones del auto, orden temporal.
- `getMemoryCard(vehicleKey)` → fila de `vehicle_memory_card` (o regenerar).

La ruta usa `vehicleKey` (ya hasheado) como parámetro: **el VIN nunca aparece en
la URL**.

## Plan de implementación por fases

Al estilo del ADR-0004: cada fase es desplegable sola y de-riskea la siguiente.

- **Fase 0 — Identidad estable (`vehicleKey`).** Columna en `vehicles` +
  `vehicle_profile`, `vehicleKeyFor()`, backfill `ALTER TABLE` idempotente,
  upsert por `vehicleKey` en `connect-to-vehicle.ts`. **Cero cambio de UI.**
  Arregla el bug de duplicados por VIN y habilita todo lo demás. Es también el
  `vehicleProfile` que la Fase 3 del ADR-0004 necesita.
- **Fase 1 — Ledger episódico.** Tabla `vehicle_episode` + append al cerrar
  sesión (`save-diagnostic-report.ts`), con `occurredAt`/`knowledgeVersion` del
  clock inyectado. Detección pasiva de `recurrence` (DTC ya visto en este auto) y
  `cleared`. Sin recall todavía → sin cambio de comportamiento.
- **Fase 2 — Recall determinístico.** `recallVehicleMemory()` enchufado al
  ensamblado del prompt de CARpsy, detrás de priors y semántica, con cap duro
  < 512 tokens y degradación a `''` en cold-start.
- **Fase 3 — Front Garage.** Pestaña + detalle por `vehicleKey`, reusando
  `SessionCard`/`TroubleCodeCard`/`/interpretation/[id]`. Reportes intacto.
- **Fase 4 — Consolidación "dreaming".** Card determinístico al cierre; CARpsy
  opcional detrás de `dreamingEnabled`, con `sourceHash` y fallback siempre
  disponible.

**Fuera de scope (explícito):** este ADR **no** incluye Acurast, ni agregación
federada, ni TEE. La memoria episódica es **por dispositivo, por vehículo, local**.
La exportación de deltas a la flota es territorio del lazo *procedural* (ADR-0004
§Fase 4) y sigue ahí; la episódica es íntima del auto y no se federa.

## Consecuencias

### Positivas

- Cierra la tercera pata de la memoria (episódica) sin red ni reentrenamiento,
  reforzando la tesis offline-first.
- Recall determinista y barato en el hot path; el LLM queda confinado a un punto
  post-hoc, opcional y con fallback.
- Reusa la `caseSignature` del ADR-0004 → procedural y episódica se cruzan por la
  misma clave; entrega el `vehicleProfile` de la Fase 3 "gratis".
- Arregla un bug real preexistente: la identidad de vehículo inestable
  (`adapterAddress-Date.now()`) que duplicaba filas por VIN.
- Front de bajo riesgo: pestaña nueva, Reportes sin tocar, componentes reusados.
- Verdad inmutable + cache reconstruible → auditabilidad total, igual que ADR-0004.

### Negativas / costos

- Tres tablas nuevas y otra migración Drizzle; superficie de esquema mayor.
- `vehicle_episode` es append-only → crece sin techo; requiere política de
  retención/compactación (abajo).
- La consolidación con CARpsy agrega una invocación al cierre de sesión (mitigada:
  best-effort, no bloqueante, desactivable).
- Una 5ª pestaña agrega peso a la barra de navegación.

### Riesgos y mitigaciones

- **Crecimiento append-only de `vehicle_episode`** → política de retención:
  compactar episodios viejos de baja señal (mismo `caseSignature`, `outcome:
  unknown`) en un resumen y conservar full los `confirmed`/`refuted`/`recurrence`.
  El card nunca depende del volumen porque tiene cap de tokens.
- **Cold-start** → recall devuelve `''` y el prompt degrada a semántica + priors
  globales; comportamiento idéntico al actual.
- **Sobre-inyectar contexto en un 0.6B** → el cap **duro** < 512 tokens y el
  ranking exact-signature-first existen precisamente para esto; más historia no es
  mejor, es ruido que desplaza la señal en una ventana chica.
- **VIN como PII-adjacent** → sólo entra como `sha256(vin)`; nunca crudo en la
  columna clave, en logs ni en rutas (`garage/[vehicleKey]` usa el hash). El VIN
  legible sigue sólo en `vehicles.vin` para mostrarlo en su pantalla, no como índice.
- **Reproducibilidad cuando el card lo genera CARpsy** → `sourceHash` + builder
  determinístico siempre recomputable desde `vehicle_episode`; con `dreaming` off
  el sistema es 100% determinista.
- **Drift card ↔ episodios** → `sourceHash` no coincide ⇒ regenerar; el card es
  cache desechable por contrato.

## Alternativas consideradas

- **Recall vía LLM (resumir la historia con CARpsy en cada consulta):** descartado.
  Mete un 0.6B no determinista en el hot path, rompe reproducibilidad y suma
  latencia en la ruta caliente. El LLM se queda en consolidación post-hoc.
- **Keyear la memoria episódica sólo por `caseSignature` (sin `vehicleKey`):**
  descartado. Es justo lo que ya hace el lazo procedural; no distingue ESTE auto y
  no resuelve el caso taller multi-vehículo.
- **Memoria episódica dentro de Reportes (Opción A):** descartado. Invierte la
  arquitectura de información de una pantalla cronológica y refactoriza más para
  lograr menos que una pestaña dedicada.
- **VIN crudo como clave de vehículo:** descartado. PII-adjacent como índice, en
  logs y en URLs; el hash local da la misma estabilidad sin el riesgo.
- **Federar la memoria episódica (Acurast/TEE):** fuera de scope. La episódica es
  íntima del auto; lo federable son los counts agregados del lazo procedural, que
  ya viven en el ADR-0004 §Fase 4.
