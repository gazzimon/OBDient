# Análisis de Protocolos OBD-II por Marca — Documento de Referencia

**Tipo**: Análisis puro / documentación de investigación
**Estado**: NO implementar — solo referencia para decisiones futuras
**Fecha**: 2026-07-22
**Contexto**: Este documento consolida y organiza por fabricante todo lo investigado sobre protocolos OBD-II, Mode 0x06, y limitaciones de hardware. Complementa a [PROTOCOL_ANALYSIS_MODE_0x06.md](PROTOCOL_ANALYSIS_MODE_0x06.md), que está organizado por protocolo en vez de por marca.

---

## PARTE 0: El "Handshake Determinista" — Cómo la Conexión Misma Revela el Vehículo

Antes de leer un solo DTC o PID, la **secuencia de inicialización ELM327** ya funciona como una encuesta determinista que va acotando qué vehículo tienes enfrente. Cada paso descarta candidatos:

```
Paso 1: ATZ (reset) → sin info de vehículo aún

Paso 2: ATSP0 (auto-protocol) → el ELM327 prueba protocolos en orden:
        SAE J1850 PWM → SAE J1850 VPW → ISO 9141-2 → ISO 14230-4 → ISO 15765-4 (CAN)
        
        El PRIMER protocolo que responde ya reduce drásticamente el universo de marcas:
        
        ├─ Responde a J1850 PWM  → Ford/Mazda (pre-2008), ELIMINA GM/Chrysler/Asiáticos/Euro
        ├─ Responde a J1850 VPW  → GM (pre-2008), ELIMINA todo lo demás
        ├─ Responde a ISO 9141-2 → Chrysler viejo / Asiático viejo / Euro viejo (pre-2005)
        ├─ Responde a KWP2000    → Honda/Toyota 2003-2006, VW/BMW pre-2007
        └─ Responde a CAN        → Cualquier marca 2008+ (universo se abre de nuevo,
                                    pero ya sabemos que es 2008+)

Paso 3: ATDP (display protocol) → confirma cuál de los anteriores, con precisión de sub-variante
        (ej: "ISO 15765-4 CAN 11-bit 500kbps" vs "29-bit" ya distingue año/plataforma aprox.)

Paso 4: Timing de respuesta (latencia observada) → afina generación de ECU:
        - CAN <100ms latencia típica = ECU moderna (2015+)
        - CAN 150-250ms = ECU CAN temprana (2008-2014)
        - K-Line 200-400ms = pre-CAN (1996-2008)

Paso 5: Mode 0x01 PID 0x01 (readiness bits) → el LAYOUT de bits ya es distinto por fabricante
        (Honda a veces devuelve 3 bytes en vez de 2 — ver sección Honda)

Paso 6: Mode 0x09 PID 0x02 (VIN) → CONFIRMACIÓN DEFINITIVA
        El WMI (World Manufacturer Identifier, primeros 3 caracteres del VIN)
        da fabricante, país y a veces división exacta.
```

**Implicación práctica**: para cuando OBDient llega al VIN (Mode 0x09), ya tenía una hipótesis de marca/año/generación de ECU con alta probabilidad, basada puramente en qué protocolo respondió y con qué timing. Esto es relevante para lo que el usuario señaló: **la conversación/negociación en sí misma ya es una fuente de datos determinista sobre el vehículo**, independiente de que el usuario diga la marca explícitamente.

Esto no se implementa como "detección" separada — ya está implícito en el flujo existente (`ATDP` en `elm327.datasource.ts`), simplemente no está siendo aprovechado como señal de identidad vehicular antes del VIN.

---

## PARTE 1: GENERAL MOTORS (Chevrolet, GMC, Cadillac, Buick)

### 1.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2007 | SAE J1850 VPW (10.4 kbps) | Pin 2 (Bus+ único, sin Bus-) |
| 2008+ | ISO 15765-4 CAN (500 kbps, 11-bit) | Pines 6/14 |
| Diesel HD (Duramax) | SAE J1939 (250 kbps, 29-bit) | Pines 6/14 (compartido con HS-CAN en muchos casos) |

### 1.2 Bus de carrocería/confort
GM **no usa "MS-CAN"** (eso es terminología Ford). GM usa **SW-CAN / GMLAN de baja velocidad** (SAE J2411):
- **Pin 1** (no 3/11 como Ford)
- Bus de **un solo cable** (single-wire), 33.3 kbps
- Requiere un **transceiver distinto** (no compatible con el MCP2551-clase usado para HS-CAN)
- **Un ELM327 estándar NO puede leerlo ni con switch DPDT** — necesita un chip transceiver físicamente diferente, no solo una reconexión de pines

**Consecuencia para Mode 0x06**: en GM, cualquier monitor que viva en módulos de confort (radio, HVAC standalone) vía SW-CAN es inalcanzable con hardware estándar. A diferencia de Ford, aquí ni el switch DPDT ayuda — se necesita un adaptador con transceiver dual explícito.

### 1.3 Mode 0x06 — comportamiento específico GM
- Soporte **excelente** en VPW y CAN
- Extiende con MIDs propietarios **0x0B-0x0E**:
  - `0x0B`: Presión de turbo/sobrealimentador
  - `0x0C`: Desactivación de cilindros (V8 modo Active Fuel Management)
  - `0x0D`: Aprendizaje adaptativo de transmisión
- Bits de readiness (Mode 0x01 PID 0x01) siguen el layout SAE estándar
- Timeout recomendado: 100ms en CAN, 200ms en VPW

### 1.4 Confiabilidad ELM327
- VPW: 75-85% (protocolo sensible a timing, ruido EMI afecta más)
- CAN: 92-95%
- Clones baratos: mercado GM es el **más común objetivo de clones** → mejor soporte de firmware en general, paradójicamente

### 1.5 Huella de "handshake determinista"
- Responde a VPW (no PWM) → ya distingue de Ford en la primera negociación
- WMI del VIN: `1G1`, `1GC`, `1G6` (Chevrolet/GMC/Cadillac), `2G1` (Canadá), `3G1` (México)

---

## PARTE 2: FORD / MAZDA (plataformas compartidas)

### 2.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2003 | SAE J1850 PWM (41.6 kbps) | Pines 2 (Bus+) y 10 (Bus-) |
| 2008+ | ISO 15765-4 CAN (500 kbps) | Pines 6/14 |
| Post-2015 (plataforma CGEA) | CAN con gateway central | Pines 6/14, MS-CAN físico eliminado |

### 2.2 Bus de carrocería/confort — EL CASO MÁS DOCUMENTADO
Ford **sí** implementa un segundo bus físico expuesto en el DLC:
- **MS-CAN (Medium-Speed CAN)**: 125 kbps, en **pines 3/11**
- Módulos ahí: BCM, IPC (tablero de instrumentos), HVAC, Radio
- HS-CAN (motor/transmisión/ABS) permanece en 6/14

**Limitación de hardware confirmada**: un dongle ELM327 Bluetooth estándar (como el usado por OBDient) tiene el transceiver CAN soldado **únicamente** a pines 6/14. Acceder a MS-CAN requiere:
1. Modificación física: desoldar y añadir switch DPDT manual (alterna entre 6/14 y 3/11, nunca simultáneo), o
2. Comprar un adaptador con doble transceiver (ej. OBDLink EX)

**Ningún AT command evade esto** — es límite de cableado físico, no de firmware.

### 2.3 Cambio reciente de arquitectura
Fords post-2015 (plataforma CGEA) **eliminaron el bus MS-CAN físico separado** en el DLC, reemplazándolo por un gateway central ("HS2-CAN") que expone todo por 6/14. Esto significa:
- Fords 2008-2014: problema de MS-CAN vigente
- Fords 2015+: probablemente sin este problema (verificar por generación/modelo específico)

### 2.4 Mode 0x06 — comportamiento específico Ford
- Respuesta de **frame único** (sin segmentación multi-frame en PWM)
- Máximo 8 bytes de datos de monitor por MID
- El monitor EGR puede reportar "NOT READY" en los primeros ciclos de manejo — **por diseño**, no es fallo
- El monitor EVAP requiere nivel específico de tanque de combustible (no solo arranque en frío)
- PIDs propietarios vía Mode 0x22: `0x24` (cruces de sensor O2), `0xF4` (detalle de fuel trim)
- Timeout recomendado: 150ms (protocolo más rápido que GM en PWM)

### 2.5 Confiabilidad ELM327
- PWM: 80-85% (propenso a colisiones CSMA)
- CAN: 93-95%
- Soporte de clones: **bueno**, protocolo bien documentado

### 2.6 Huella de "handshake determinista"
- Responde a PWM (no VPW) → distingue de GM en la primera negociación
- WMI: `1FA`/`1FM`/`1FT` (Ford USA), `3FA` (México), `1YV`/`4F2` (Mazda con plataforma Ford compartida)
- Mazda comparte protocolo con Ford en años de plataforma compartida (2000s), pero Mazda pura usa su propio WMI

---

## PARTE 3: HONDA / ACURA

### 3.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2002 | ISO 9141-2 K-Line (10.4 kbps) | Pin 7 |
| 2003-2005 | ISO 14230-4 KWP2000 (K-Line) | Pin 7 |
| 2005-2010 | ISO 15765-4 CAN (transición) | Pines 6/14 |
| 2010+ | CAN exclusivo, K-Line eliminado | Pines 6/14 |

### 3.2 Particularidad estructural: valores de 32-bit
**Honda es la excepción más notable a la codificación estándar SAE de 8-bit.** El monitor de sensor O2 (MID 0x06) en Honda devuelve valores de **32-bit**, no el estándar de 1 byte:

```
Respuesta SAE estándar:    46 06 [cap] [valor 1 byte] [min] [max]
Respuesta Honda:           46 06 [cap] [valor byte1] [byte2] [byte3] [byte4]
```

Un parser genérico que asuma 1 byte de valor **fallará silenciosamente o leerá basura** en Honda. Esto no es un bug del vehículo — es una decisión de diseño de Honda que se sale del byte-count típico SAE.

### 3.3 Monitores en secuencia estricta
A diferencia de Ford/GM (que corren monitores en paralelo), Honda ejecuta sus monitores **en secuencia estricta**. Esto implica:
- Si pides MID 0x06 mientras MID 0x04 aún está corriendo, puede devolver "not ready" incluso si en otras marcas ya habría datos parciales
- Mayor sensibilidad a timing de solicitud vs. ciclo de manejo

### 3.4 Catalizador dual-threaded
Honda evalúa el catalizador primario y secundario **independientemente** (no como un solo test combinado):
- Umbral catalizador primario: ~88% eficiencia
- Umbral catalizador secundario: ~75% eficiencia (falla primero en la práctica, ~150k millas típico)

### 3.5 Confiabilidad ELM327 — la más problemática de las marcas mayores
- K-Line/KWP2000: **muchos clones ELM327 tienen timeout en la negociación de protocolo Honda**
- Requiere firmware **v1.4.5+** para soporte confiable
- Workaround documentado: forzar `ATSP6` (modo K-Line manual) cuando el auto-detect falla
- CAN (2005+): mucho más confiable, comparable a otras marcas

### 3.6 Huella de "handshake determinista"
- Si responde a KWP2000 en vez de ISO 9141-2 puro → sugiere Honda/Toyota 2003-2006 (ambos comparten esta ventana), hay que distinguir por VIN
- WMI: `1HG`/`2HG`/`3HG` (Honda), `19U`/`2HN`/`19V` (Acura)
- Señal adicional: si Mode 0x01 PID 0x01 devuelve **3 bytes en vez de 2** (bit extra para sistemas híbridos) → indicador de Honda con powertrain híbrido

---

## PARTE 4: TOYOTA / LEXUS

### 4.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2002 | ISO 9141-2 K-Line | Pin 7 |
| 2003-2005 | ISO 14230-4 KWP2000 | Pin 7 |
| 2006+ | ISO 15765-4 CAN | Pines 6/14 |
| 2015+ | CAN + extensiones propietarias (híbridos) | Pines 6/14 |

### 4.2 Cumplimiento OBD-II — el más completo de la industria
Toyota es ampliamente reconocida como **pionera y la más rigurosa** en cumplimiento SAE J1979-1 completo. Esto se traduce en:
- Mayor tasa de éxito de Mode 0x06 en general (~excelente en CAN)
- Menos "sorpresas" de formato de datos comparado con Honda o Ford

### 4.3 Monitores específicos de híbridos (Prius, RAV4 Hybrid, Camry Hybrid, etc.)
| MID | Test | Señal predictiva |
|---|---|---|
| `0x0C` | Batería híbrida (carga/descarga) | SOH (State of Health) <70% precede reemplazo (~150k millas) |
| `0x0E` | Motor-generador | Pérdida de eficiencia → degradación de bobinado |
| `0x0F` | Inversor de potencia | Rendimiento térmico → envejecimiento de capacitores (ESR sube) |

**Nota importante**: estos MIDs de híbrido son propietarios de Toyota, no SAE estándar. Solo aplican a modelos con powertrain híbrido, no a Toyota de combustión pura.

### 4.4 Arquitectura de gateway (no hay "MS-CAN Toyota")
Toyota **no expone un segundo bus físico en el DLC** como Ford. Los módulos de carrocería (BCM, climatizador) están detrás de un **gateway central** que los puentea hacia el bus estándar 6/14. Esto significa:
- Un ELM327 estándar (sin modificación) puede generalmente alcanzar diagnósticos de módulos de confort en Toyota, sujeto a las restricciones de UDS/security access del gateway
- Ventaja sobre Ford: no hay limitación física de pines, aunque puede haber limitación de "security access" (ver KWP2000 más abajo)

### 4.5 Confiabilidad ELM327
- K-Line/KWP2000: **buena**, pero comparte con Honda la ambigüedad de protocolo en la ventana 2003-2006
- CAN: **excelente**, de las más confiables del mercado

### 4.6 Huella de "handshake determinista"
- WMI: `JT2`/`JTD`/`4T1`/`5TD` (Toyota), `JTH`/`2T2` (Lexus)
- Si el vehículo responde con MIDs 0x0C/0x0E/0x0F propietarios → alta probabilidad de ser modelo híbrido, incluso antes de confirmar por VIN

---

## PARTE 5: CHRYSLER / JEEP / DODGE / RAM (FCA, incluye Fiat post-fusión)

### 5.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2007 | ISO 9141-2 K-Line | Pin 7 |
| 2005+ | ISO 15765-4 CAN | Pines 6/14 |
| 2008+ | CAN exclusivo (K-Line descontinuado) | Pines 6/14 |

### 5.2 Bus de carrocería — arquitectura mixta, inconsistente
A diferencia de Ford (siempre separado) o Toyota (siempre gateway), Chrysler es **inconsistente entre modelos/años**:
- **CAN-C**: bus de alta velocidad — PCM, ABS, ORC/airbags
- **CAN-IHS** (Interior High Speed): bus de carrocería — radio, HVAC, iluminación

Algunos modelos rutean CAN-IHS a pines 3/11 (como Ford), pero **muchos otros lo puentean a través del módulo TIPM** (gateway) hacia los pines estándar 6/14. Esto quiere decir que **no hay una regla única para Chrysler** — depende del modelo/año específico, y hay que verificar caso por caso si un ELM327 estándar alcanza los módulos de carrocería o no.

### 5.3 Mode 0x06 — comportamiento específico
- Cumplimiento SAE estándar, protocolo CAN-only bien documentado
- El estado de readiness usa un **flag de batería separado**: los monitores se resetean tras desconexión de batería (más agresivo que otras marcas)
- MIDs propietarios: `0x04` (catalizador — evalúa ambos convertidores independientemente, similar a Honda), `0x0B` (aprendizaje adaptativo de transmisión, fallo no recuperable si se corrompe), `0x0D` (detección de fuga de tapa de combustible — falsos positivos comunes por tapa floja)

### 5.4 Confiabilidad ELM327
- K-Line: buena
- CAN: buena (protocolo bien documentado, sin las rarezas de Honda)

### 5.5 Huella de "handshake determinista"
- WMI: `1C3`/`1C4`/`1C6` (Chrysler/Jeep/Ram), `2C3`/`2C4` (Canadá), `ZFA` (Fiat post-fusión, prefijo italiano)
- Nota: **Fiat post-2014 comparte plataformas y a veces protocolo con Chrysler** debido a la fusión FCA — el WMI sigue siendo la señal más confiable para distinguir origen real de la ECU

---

## PARTE 6: BMW / MINI

### 6.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2003 | ISO 9141-2 K-Line | Pin 7 |
| 2004-2006 | ISO 14230-4 KWP2000 | Pin 7 |
| 2007+ | ISO 15765-4 CAN (alta velocidad, 500 kbps) | Pines 6/14 |

### 6.2 EL CASO ESPECIAL: Mode 0x06 es solo "advisory"
BMW es la marca donde el estándar OBD-II importa menos. BMW cumple el **mínimo legal** para pasar emisiones, pero su diagnóstico real y profundo vive en **Mode 0xF1** (propietario, fuera del estándar OBD-II).

- Mode 0x06 estándar: soportado de forma "advisory" — funciona, pero da información limitada
- Diagnóstico completo (turbo, trampa de NOx, etc.): solo vía Mode 0xF1

### 6.3 Limitación de hardware con ELM327
**Muchos clones ELM327 no pueden negociar CAN-HS de BMW correctamente**, ni Mode 0xF1. Herramientas especializadas (Peake Research MSD80, adaptadores Techchip) reemplazan al ELM327 genérico para diagnóstico BMW serio.

**Consecuencia para OBDient**: usuarios BMW obtendrán datos de Mode 0x06 estándar (limitados) pero **no** los monitores propietarios de mayor valor (boost de turbo, eficiencia de trampa NOx), que están detrás de Mode 0xF1, inalcanzable con hardware ELM327 estándar.

### 6.4 Confiabilidad ELM327
- K-Line/KWP2000: pobre-regular
- CAN: pobre para Mode 0xF1, aceptable para Mode 0x06/0x01/0x03 estándar

### 6.5 Huella de "handshake determinista"
- WMI: `WBA`/`WBS`/`WBY` (BMW), `WMW` (Mini)
- Señal adicional: si Mode 0x06 responde pero con datos muy limitados/genéricos comparado con lo esperado → sugiere BMW (comportamiento "advisory only")

---

## PARTE 7: VW / AUDI / PORSCHE (Grupo VAG)

### 7.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2008 | ISO 14230-4 KWP2000 (K-Line) | Pin 7 |
| 2009+ | ISO 15765-4 CAN (500 kbps) | Pines 6/14 |

### 7.2 Advertencia crítica: sin OBD-II estándar antes de 2009
**Pre-2009, VAG no ofrece soporte estándar de OBD-II** en el sentido pleno — usa diagnóstico UDS propietario. Esto significa que para vehículos VW/Audi/Porsche anteriores a 2009:
- Mode 0x06 puede no estar disponible en absoluto, o estar muy limitado
- El diagnóstico real requiere protocolos propietarios (VAG-COM/VCDS style), no ELM327 genérico

### 7.3 KWP2000 y Security Access — relevante para VAG específicamente
De los protocolos analizados, **KWP2000 con seed/key security access es particularmente común en VAG**. Esto significa:
- Algunos monitores/PIDs requieren "desbloqueo" con un algoritmo semilla→clave antes de poder leerse
- ELM327 **no maneja esto automáticamente** — la app tendría que implementar el algoritmo (documentado en foros para modelos comunes, pero no universal)
- Sin este desbloqueo, ciertas lecturas devuelven `7F 27 33` (Security access denied)

### 7.4 Monitores extendidos VAG (2009+, post-CAN)
| MID | Test | Señal |
|---|---|---|
| `0x0B` | Fuel trim adaptativo | Desgaste de inyector (respuesta no lineal) |
| `0x11` | Aleta de admisión turbo | Desgaste mecánico, agarrotamiento |
| `0x12` | Enfriador de EGR | Eficiencia de intercambio de calor, acumulación de carbón |

### 7.5 Confiabilidad ELM327
- KWP2000 (pre-2009): parcial, dependiente del modelo, requiere manejo de TesterPresent
- CAN (2009+): buena, comparable a otras marcas europeas

### 7.6 Huella de "handshake determinista"
- WMI: `WVW`/`WV1`/`WV2` (VW), `WAU`/`WA1` (Audi), `WP0`/`WP1` (Porsche)
- Si el vehículo es pre-2009 y responde con KWP2000 pero con muchos rechazos de security access → alta probabilidad VAG

---

## PARTE 8: HYUNDAI / KIA

### 8.1 Línea de tiempo de protocolo
| Años | Protocolo | Pines |
|---|---|---|
| 1996-2005 | ISO 9141-2 K-Line | Pin 7 |
| 2003-2006 | ISO 14230-4 KWP2000 | Pin 7 |
| 2006+ | ISO 15765-4 CAN | Pines 6/14 |
| 2010+ | CAN como protocolo primario/exclusivo | Pines 6/14 |

### 8.2 Cumplimiento estándar, sin sorpresas mayores
A diferencia de Honda (valores 32-bit) o BMW (Mode 0xF1), Hyundai/Kia **siguen el estándar SAE sin variaciones estructurales notables**. Es de las marcas más "predecibles" para implementar Mode 0x06.

### 8.3 Confiabilidad ELM327
- Buena en todos los protocolos, sin las rarezas que complican Honda/BMW

### 8.4 Huella de "handshake determinista"
- WMI: `KMH`/`KM8` (Hyundai), `KNA`/`KND` (Kia)

---

## PARTE 9: DIESEL PESADO (Cummins, Duramax, plataformas J1939)

### 9.1 Contexto
J1939 no es una marca sino un protocolo para vehículos pesados/diésel, usado por motores Cummins (en Dodge/Ram HD), Duramax (Chevy/GMC HD), y maquinaria industrial.

### 9.2 Mode 0x06 NO es estándar en J1939
Los camiones pesados usan mensajes de diagnóstico propios:
- `DM01`: Códigos de falla activos
- `DM06`: Borrado/reset de datos de diagnóstico
- `DM13`: Resultados de prueba de emisiones

Esto **no es Mode 0x06** en el sentido OBD-II ligero, y requiere una implementación paralela completamente separada si OBDient alguna vez apunta a diesel pesado.

### 9.3 Soporte real observado
| Motor | Soporte Mode 0x06 estilo OBD-II | Notas |
|---|---|---|
| Cummins (Dodge Ram HD) | Solo MID 0x01 (misfire) | Otros MIDs devuelven `0xFF` (no soportado); dato real vía PGN `0x00F400` |
| Duramax (GM HD) | MIDs 0x01-0x04 | Extensión vía DM13 en vez de MIDs 0x0B+ |

### 9.4 Corrección de firmware ELM327
J1939 se agregó en **firmware v1.2** (no v1.3 como se creía inicialmente) — v1.3 solo trajo refinamientos (comandos adicionales, timing adaptativo). Selección de protocolo: `ATSP A`.

---

## PARTE 10: TABLA RESUMEN — TODAS LAS MARCAS

| Marca | Protocolo pre-CAN | Protocolo CAN | Bus confort separado | Rareza Mode 0x06 | Confiabilidad ELM327 |
|---|---|---|---|---|---|
| **GM** | J1850 VPW | ISO 15765-4 | SW-CAN (pin 1, single-wire, transceiver distinto) | MIDs 0x0B-0x0E propios | Buena-Excelente |
| **Ford/Mazda** | J1850 PWM | ISO 15765-4 | **MS-CAN (pines 3/11)** — requiere switch DPDT físico | EGR "not ready" por diseño inicial | Buena |
| **Honda/Acura** | ISO 9141-2 → KWP2000 | ISO 15765-4 | No (gateway) | **Valores 32-bit en O2 sensor**, secuencia estricta | Regular-Pobre en K-Line, Buena en CAN |
| **Toyota/Lexus** | ISO 9141-2 → KWP2000 | ISO 15765-4 | No (gateway) | MIDs híbridos propios (batería, inversor) | Excelente |
| **Chrysler/Jeep** | ISO 9141-2 | ISO 15765-4 | Inconsistente (a veces sí, a veces gateway) | Catalizador dual, reset agresivo de readiness | Buena |
| **BMW/Mini** | ISO 9141-2 → KWP2000 | ISO 15765-4 | N/A | **Mode 0x06 solo "advisory"**, real diagnóstico en Mode 0xF1 | Pobre-Regular |
| **VW/Audi/Porsche** | KWP2000 | ISO 15765-4 (solo 2009+) | N/A | **Pre-2009 sin OBD-II real**, security access frecuente | Parcial-Buena |
| **Hyundai/Kia** | ISO 9141-2 → KWP2000 | ISO 15765-4 | No (gateway) | Sin rarezas notables | Buena |
| **Diesel HD (J1939)** | N/A | J1939 (29-bit) | N/A | Mode 0x06 NO estándar, usa DM01/DM06/DM13 | Pobre (<50%) |

---

## PARTE 11: Implicación General (sin acción de código)

Este documento confirma que **no existe un parser único de Mode 0x06** que funcione igual en todas las marcas. Las variaciones no son solo de protocolo (CAN vs K-Line vs PWM/VPW, ya cubierto en el documento anterior) sino también **específicas de fabricante dentro del mismo protocolo**:

- Mismo CAN, pero Honda usa 32-bit y GM usa 8-bit estándar
- Mismo CAN, pero BMW considera Mode 0x06 "opcional" y GM lo implementa a fondo
- Mismo K-Line, pero VAG añade security access y Chrysler no

Cualquier futura implementación de Mode 0x06 necesitaría, como mínimo:
1. Detectar protocolo (ya existe vía `ATDP`)
2. Detectar fabricante (vía WMI del VIN, ya se lee en `connect-to-vehicle.ts`)
3. Aplicar un parser/config específico por combinación protocolo+fabricante, no solo por protocolo

Esto queda documentado como **análisis de referencia** — ninguna parte de este contenido ha sido implementada en código.
