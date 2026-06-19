# QA & Mejoras — Evolución de la Inteligencia de CARpsy

Documento de trazabilidad de todas las mejoras aplicadas al stack de IA de OBDient
en la sesión de desarrollo del 19/06/2026. Cada sección describe el estado anterior,
el cambio aplicado, y el impacto observable en el comportamiento del agente.

---

## 1. Carga del Modelo LLM

### Antes
El modelo no cargaba. El SDK de QVAC retornaba `[50008] modelType is required`
porque `loadModel()` se llamaba sin el parámetro obligatorio.

```typescript
// ❌ antes
await loadModel({ modelSrc });

// ✅ después
await loadModel({ modelSrc, modelType: 'llamacpp-completion' });
```

**Archivo:** `src/data/datasources/qvac-sdk.datasource.ts`

### Impacto
Sin este fix el agente nunca arrancaba. Es el prerequisito de toda la inteligencia.

---

## 2. Eliminación de Tokens `<think>`

### Antes
El modelo Qwen3-0.6B genera tokens de razonamiento interno (`<think>…</think>`)
que se filtraban directamente a la UI. El usuario veía el proceso de pensamiento
crudo del modelo en lugar de la respuesta final.

```
<think>
El usuario pregunta sobre el vehículo. Debo analizar los DTCs...
</think>
No encuentro códigos de falla.
```

### Después
Se agregó `stripThinkingTokens()` aplicado a todos los paths de retorno:

```typescript
function stripThinkingTokens(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}
```

**Archivo:** `src/data/datasources/qvac-sdk.datasource.ts`

### Impacto
El agente presenta solo la conclusión, sin exponer su razonamiento interno.
Mejora percepción de calidad y confianza del usuario.

---

## 3. Datos de Sensores OBD-II Llegando al Modelo

### Antes
El sistema context que se enviaba al modelo NO incluía las lecturas de sensores
en tiempo real. El modelo respondía sin saber RPM, temperatura, MAF, etc.

### Después
`buildSystemContext()` en `chat-with-qvac.ts` ahora inyecta el snapshot completo
de parámetros OBD-II:

```
Live OBD-II sensor readings:
  Engine RPM: 800.0 rpm
  Coolant Temperature: 92.0 °C
  Mass Air Flow: 4.2 g/s
  ...
```

**Archivo:** `src/domain/usecases/chat-with-qvac.ts`

### Impacto
El modelo puede razonar sobre el estado real del vehículo. Antes decía
"no tengo datos" o inventaba valores. Ahora fundamenta sus respuestas
en mediciones reales.

---

## 4. Expansión de Sensores: 8 → 20 PIDs

### Antes
Solo se leían 8 PIDs básicos: RPM, Speed, Coolant, Load, MAF, TPS, IAT, Voltage.

### Después
Se agregaron 12 nuevos PIDs con parsers SAE J1979 correctos:

| PID | Comando | Fórmula | Utilidad para el modelo |
|-----|---------|---------|------------------------|
| `FUEL_TRIM_SHORT` | `0106` | `(A/128-1)*100` % | Detecta problemas de mezcla aire/combustible |
| `FUEL_TRIM_LONG` | `0107` | `(A/128-1)*100` % | Tendencias de ajuste a largo plazo |
| `TIMING_ADVANCE` | `010E` | `A/2-64` ° | Estado del sistema de ignición |
| `INTAKE_MAP` | `010B` | `A` kPa | Vacío del múltiple, detección de fugas |
| `O2_B1S1` | `0114` | `A*0.005` V | Estado del sensor de oxígeno upstream |
| `O2_B1S2` | `0115` | `A*0.005` V | Estado del catalizador |
| `RUN_TIME` | `011F` | `A*256+B` s | Contexto de ciclo de conducción |
| `FUEL_LEVEL` | `012F` | `A*100/255` % | Nivel de combustible |
| `BAROMETRIC` | `0133` | `A` kPa | Presión atmosférica (altitud) |
| `CATALYST_TEMP` | `013C` | `(A*256+B)/10-40` °C | Temperatura del catalizador |
| `RELATIVE_TPS` | `0145` | `A*100/255` % | Posición relativa del acelerador |
| `AMBIENT_TEMP` | `0146` | `A-40` °C | Temperatura ambiente |

**Archivos:** `src/core/constants/pids.ts`, `src/core/utils/obdParser.ts`

### Impacto
El modelo recibe 2.5× más información del vehículo. Diagnósticos de mezcla
(fuel trim), ignición (timing advance), y estado del catalizador ahora son
posibles sin necesidad de DTCs activos.

---

## 5. RAG Conectado al Flujo de Chat (Primera Iteración)

### Antes
El método `chat()` en `LLMRepositoryImpl` NO usaba SHIMI ni RAG.
Solo pasaba el historial directamente al LLM sin ningún contexto de conocimiento.

```typescript
// ❌ antes — chat sin conocimiento
async chat(request): Promise<Result> {
  const result = await qvacSDK.chat(request.systemContext, request.history);
  return { ...result, isAiGenerated: true };
}
```

### Después (iteración 1)
Se conectó `shimiDataSource.search()` usando el último mensaje del usuario
como query de recuperación.

**Archivo:** `src/data/repositories/llm.repository.impl.ts`

### Limitación identificada
El `dtcId` se pasaba como `undefined` → la capa jerárquica de SHIMI
retornaba `[]` siempre. Solo el RAG vectorial corría, con el texto
conversacional crudo como query (baja calidad de recuperación).

---

## 6. SHIMI + SKOS + Ontología Conectados al Chat (Iteración Final)

### Arquitectura completa del stack de inteligencia

```
Usuario: "mi motor tiembla"
                │
                ▼
    ┌─ buildRetrievalQuery() ────────────────┐
    │  DTCs activos + parámetros con alertas  │
    │  → "P0300 misfire; RPM warning"         │
    └─────────────────────────────────────────┘
                │
                ▼
    ┌─ retrievalContext(primaryDtcId) ───────┐
    │  SKOS: DTC → concepto canónico         │
    │  + ancestros + nodos relacionados       │
    │  P0300 → misfire_random → ignition      │
    │        → powertrain → emissions         │
    │        → fuel_system (related)          │
    │  → "Ignition system; Powertrain (P);    │
    │     Emissions; Fuel system"             │
    └─────────────────────────────────────────┘
                │
                ▼
         expandedQuery =
         userMessage + diagnosticQuery + ontologyExpansion
                │
                ▼
    ┌─ shimiTree.search(dtcId, expandedQuery) ┐
    │  Layer 1: jerárquico por confianza       │
    │  Nodos más confirmados → snippets        │
    │  rankeados primero                       │
    └─────────────────────────────────────────┘
                │
    ┌─ qvacRag.search(expandedQuery) ─────────┐
    │  Layer 2: similitud vectorial            │
    │  EmbeddingGemma 300M (4-bit)            │
    │  Captura casos no cubiertos por SKOS    │
    └─────────────────────────────────────────┘
                │
    ┌─ evaluatePatterns() ────────────────────┐
    │  Layer 3: patrones condicionales        │
    │  Evalúa reglas against snapshot live    │
    └─────────────────────────────────────────┘
                │
                ▼
    "Relevant diagnostic knowledge:
     [1] DTC P0300 — Random misfire...
     [2] Ignition system — spark plugs...
     [3] Pattern (0.85): RPM instability..."
                │
                ▼
         qvacSDK.chat() → respuesta
```

**Cobertura por flujo:**

| Capa | `interpret()` (auto) | `chat()` antes | `chat()` ahora |
|------|---------------------|----------------|----------------|
| SHIMI jerárquico | ✅ | ❌ | ✅ |
| SKOS expansion | ✅ | ❌ | ✅ |
| QVAC RAG vectorial | ✅ | ⚠️ query cruda | ✅ query enriquecida |
| Hypercore patterns | ✅ | ❌ | ✅ |

**Archivos modificados:**
- `src/domain/repositories/i-llm.repository.ts` — `LLMChatRequest` recibe `troubleCodes` + `parameters`
- `src/domain/usecases/chat-with-qvac.ts` — pasa los datos al repo
- `src/data/repositories/llm.repository.impl.ts` — `chat()` con stack completo

---

## 7. Conversaciones Guardadas en SQLite

### Antes
Las conversaciones vivían solo en Zustand (RAM). Al cerrar la app o
finalizar la sesión, el historial de chat se perdía.

### Después
Se agregaron columnas `messages_json` y `mileage` a la tabla `sessions`.
Las conversaciones se persisten automáticamente al finalizar la sesión
y se muestran en la pantalla de detalle del reporte.

**Archivos modificados:**
- `src/data/db/schema.ts` — columnas nuevas
- `src/data/datasources/storage.datasource.ts` — migración idempotente
- `src/domain/repositories/i-report.repository.ts` — `messageCount` en lista
- `src/data/repositories/report.repository.impl.ts` — serialización/deserialización
- `src/app/(tabs)/reports.tsx` — badge de mensajes en tarjeta
- `src/app/interpretation/[id].tsx` — sección "Chat History" con burbujas

---

## 8. System Prompt del Modelo

### Antes
El prompt era genérico o estaba ausente. El modelo pedía DTCs constantemente
incluso cuando no había ninguno, y respondía en inglés independientemente
del idioma del usuario.

### Después
```
You are OBDient, an expert automotive diagnostic assistant.
You receive real-time OBD-II vehicle data and may or may not have fault codes.
Respond in the same language the user writes in.
When a "Relevant diagnostic knowledge" section is provided, base your diagnosis
ONLY on that knowledge.
If there are NO fault codes, analyze the live sensor data and tell the user
whether everything looks normal or if anything stands out.
Prioritize safety: if something is urgent, state it in the first sentence.
Maximum 3 sentences. No unnecessary technical jargon.
```

**Archivo:** `src/data/datasources/qvac-sdk.datasource.ts`

---

## Problemas Conocidos (Pendientes)

### Sesgo de fine-tuning de CARpsy
El modelo Qwen3-0.6B fue fine-tuneado con datos que frecuentemente asocian
RPM bajas o ausencia de DTCs con verificación de aceite. Esto provoca
respuestas repetitivas ("Valide el nivel de aceite primero") independientemente
del contexto. El RAG y el system prompt mitigan esto parcialmente pero no
lo eliminan.

**Causa raíz:** bias en los datos de entrenamiento de CARpsy-v2.
**Solución a largo plazo:** reentrenamiento con datos más balanceados o
un sistema de instrucción más fuerte que pese el conocimiento recuperado
sobre el prior del modelo.

### Modelo "Unknown" en nombre del vehículo
El VIN 8AGEA76C0RR117525 resuelve como "Chevrolet Unknown 2024". El modelo
de vehículo no se obtuvo de Vincario o NHTSA. El modelo de IA no puede
contextualizar diferencias específicas por modelo de vehículo.

### Inicialización tardía del RAG
Si el usuario carga el modelo CARpsy y envía un mensaje inmediatamente,
el embedding model (EmbeddingGemma) podría no estar listo aún. La capa RAG
devuelve `[]` silenciosamente en ese caso y el modelo trabaja sin conocimiento
vectorial hasta que el embedding esté listo.

---

## Métricas de Evolución del Agente

| Dimensión | Sesión anterior | Hoy |
|-----------|----------------|-----|
| Sensores procesados | 8 | 20 |
| Capas de conocimiento en chat | 0 | 4 (SHIMI + SKOS + RAG + patterns) |
| Idioma del usuario | ❌ siempre inglés | ✅ detectado automáticamente |
| Conversaciones persistentes | ❌ | ✅ SQLite |
| Tokens `<think>` en UI | ❌ visibles | ✅ eliminados |
| Datos de sensores al modelo | ❌ | ✅ snapshot completo |
| SKOS expansion en chat | ❌ | ✅ |
| Hypercore patterns en chat | ❌ | ✅ |
