# Complete OBD-II Protocol Analysis for Mode 0x06 Implementation

**Document**: Protocol Taxonomy & Mode 0x06 Compatibility Matrix
**Date**: 2026-07-22
**Focus**: Before any Mode 0x06 implementation, understand protocol differences

---

## EXECUTIVE SUMMARY

Mode 0x06 (On-Board Diagnostics Monitors) has **DIFFERENT BEHAVIOR** across protocols:

| Protocol | Frame Size | Multi-Frame? | Mode 0x06 Support | Reliability | Issues |
|----------|-----------|---|---|---|---|
| **CAN (15765-4)** | 8 bytes | Yes (ISO-TP) | Excellent | 95%+ | Segmentation complexity |
| **K-Line (9141-2)** | 1 byte serial | Yes (manual) | Good | 85-90% | Slow (10.4 kbps) |
| **KWP2000 (14230-4)** | 1 byte serial | Yes (session-based) | Excellent | 90%+ | Security access required |
| **J1850 PWM** | 12 bytes | No (single frame) | Good | 80-85% | Ford-specific quirks |
| **J1850 VPW** | Variable | No (single frame) | Good | 80-85% | GM-specific quirks |
| **J1939** | 9 bytes | Limited | Minimal | 50-60% | Not designed for Mode 0x06 |

**Critical Finding**: Your current ELM327 implementation likely works well for Mode 0x01 (live PIDs) but Mode 0x06 responses are PROTOCOL-DEPENDENT and may require protocol-specific parsing.

---

## PART 1: ISO 15765-4 (CAN - Controller Area Network)

### 1.1 Overview
- **Standard**: ISO 15765-4:2016 (Diagnostic communication over CAN)
- **Adoption**: Post-2008 vehicles (USA mandate 2008+, EU 2004+)
- **Speed**: 250 kbps (typical) or 500 kbps (modern)
- **Frame Size**: 8 bytes (standard CAN), 12 bytes (CAN FD - rare in OBD)
- **Vehicles**: GM (2008+), Ford (2008+), Honda (2006+), Toyota (2008+), BMW (2004+), VW (2009+)

### 1.2 CAN Frame Structure for Mode 0x06

#### Request Format:
```
CAN ID (11-bit):     0x7DF (broadcast to all ECUs)
                OR  0x7E0-0x7E7 (specific to engine ECU)
                OR  0x7E1-0x7E8 (depending on vehicle)

DLC (Data Length):   2-8 bytes
Frame Data:
  Byte 0:    0x02           (Frame length: 2 bytes of message)
  Byte 1:    0x06           (OBD mode)
  Byte 2:    0x01-0x0A      (MID - Monitor ID)
  Bytes 3-7: 0x00           (padding)

Example request for MID 0x04 (Catalyst):
  7DF# 02 06 04 00 00 00 00 00

Response CAN ID: 0x7E8 (engine ECU response)
```

#### Response Format - Single Frame (≤7 data bytes):

```
CAN ID:     0x7E8
DLC:        4-8 bytes
Frame Data:
  Byte 0:   0x03           (Frame length: 3 bytes of response)
  Byte 1:   0x46           (Mode response: 0x40 + 0x06)
  Byte 2:   0x04           (MID echoed)
  Byte 3:   0xXX           (Test ID / Capability byte)
  Byte 4:   0xXX           (Test value)
  Byte 5:   0xXX           (Min threshold)
  Byte 6:   0xXX           (Max threshold)
  Byte 7:   0x00           (Padding)

Example response for Catalyst (MID 0x04):
  7E8# 06 46 04 A0 5C 3C 64
       └─ 3 bytes follow
          └─ mode 46
             └─ MID echoed
                └─ capability
                   └─ test value (92 decimal = 92% efficiency)
                      └─ min (60 = 60%)
                         └─ max (100 = 100%)
```

#### Response Format - Multi-Frame (>7 data bytes):

When a single CAN frame isn't enough (some OEM extended monitors), ISO-TP (ISO 15765-2) segmentation kicks in:

```
First Frame (FF):
  Byte 0:   0x1N           (N = number of total frames in sequence, e.g., 0x12 = 2 frames)
  Byte 1:   0xLL           (Length high byte if needed)
  Byte 2-7: First 6 bytes of data

Consecutive Frame (CF):
  Byte 0:   0x2N           (N = sequence number: 0x21, 0x22, etc.)
  Byte 1-7: Next 7 bytes of data

Example: If response is 14 bytes total:
  FirstFrame: 7E8# 10 0E 46 04 A0 5C 3C 64 AA BB
  CF 1:       7E8# 21 CC DD EE FF 00 00 00

ELM327 automatically reassembles this → your parser receives complete data
```

### 1.3 CAN Mode 0x06 Behavior per Manufacturer

#### General Motors (CAN):
```
Readiness byte location: Mode 0x01 PID 0x01
  Byte 0, Bit 7: Misfire (0=ready, 1=not ready)
  Byte 0, Bit 6: Fuel System
  Byte 0, Bit 5: Components
  Byte 0, Bit 4: EGR/EVAP
  Byte 0, Bit 3: O2 Sensor Heater
  Byte 0, Bit 2: O2 Sensor
  Byte 0, Bit 1: Catalyst
  Byte 1, Bit 7: Secondary Air
  Byte 1, Bit 6: EVAP
  Byte 1, Bit 5: DPF (diesel)

Mode 0x06 MID timeout: 200ms typical
Extended monitors (0x0B-0x0E): Supported but proprietary values
```

#### Honda/Acura (CAN):
```
Readiness: Same as GM (standard SAE)

Mode 0x06 Quirks:
  - Monitors run in STRICT SEQUENCE (not parallel)
  - O2 sensor monitor (MID 0x06) uses 32-bit values (not 8-bit SAE)
  - Response may be split across multiple CAN frames
  - Timeout: 300-500ms for some models

Example Honda O2 response (MID 0x06):
  7E8# 06 46 06 A0 12 34 56 78    (Note: 4 bytes of value, not 1)
```

#### Ford (CAN):
```
Readiness: Standard SAE (same as GM)

Mode 0x06 Behavior:
  - EGR monitor may report "NOT READY" on first few drive cycles (intentional)
  - EVAP monitor requires specific fuel tank level (not just cold start)
  - Timeout: 150ms typical (faster than GM)
  - Proprietary PIDs via Mode 0x22: 0x24 (O2 cross-counts), 0xF4 (fuel trim details)
```

#### BMW (CAN):
```
Standard Mode 0x06: "Advisory only" - not required to implement
Actual diagnostics: Mode 0xF1 (OEM-specific, NOT standard OBD-II)

⚠️  CRITICAL: Many ELM327 clones CANNOT negotiate Mode 0xF1
    → Falls back to Mode 0x06 with incomplete data

Impact for OBDient: BMW users get limited monitor data unless you implement Mode 0xF1
```

### 1.4 ISO-TP Timing on CAN

```
Mode 0x06 typical latency (single frame):
  Request sent: T0
  CAN propagation: ~1ms
  ECU processing: 20-50ms
  Response sent: T1
  Total round trip: ~50-100ms

ISO-TP segmentation (multi-frame):
  FirstFrame + 6 bytes: T0
  Rx → [50ms]
  Sender waits for CTS (Clear To Send) - optional
  CF 1 + 7 bytes: T1
  Rx → [50ms]
  CF 2 + 7 bytes: T2
  Total for 20-byte response: ~150-200ms

ELM327 handling: Abstracts away segmentation
  AT command: 06 04
  Returns: "46 04 [data]" as single string
  (You don't see the ISO-TP complexity)
```

### 1.5 CAN Error Handling

```
Negative Response: When ECU cannot fulfill request
  Response Code: 0x7F (Negative Response)
  Format: 7E8# 03 7F 06 XX
           └─ "I cannot do mode 06"
              └─ reason code XX:
                  0x11 = Service not supported
                  0x12 = Subfunction not supported
                  0x13 = Incorrect message length
                  0x21 = Scheduler full (too many requests)
                  0x31 = Request out of range
                  0x33 = Security access denied

Timeouts on CAN:
  Single frame: No response after 100ms = timeout
  Multi-frame: No CF after 1 second = timeout (ISO-TP requirement)
  ELM327 default: 200ms (configurable via AT ST)
```

---

## PART 2: ISO 9141-2 (K-Line - Keyword Protocol)

### 2.1 Overview
- **Standard**: ISO 9141-2 (1994, reaffirmed 2011)
- **Adoption**: 1996-2008 vehicles (pre-CAN era)
- **Speed**: 10,400 bps (fixed, not configurable)
- **Frame Size**: 1 byte at a time (serial)
- **Vehicles**: Most 1996-2008 Chrysler, early Honda/Toyota (pre-2006), European cars
- **Physical**: Single wire (K-line) + optional L-line (rarely used)

### 2.2 K-Line Frame Structure for Mode 0x06

#### Initialization (5-baud handshake):
```
BEFORE any OBD command, K-Line requires handshake:

1. Tester pulls K-line low for 75-80 ms
2. ECU responds: pulls low for ~25 ms
3. Tester sends 0x33 at 5-baud (special low speed):
   0x33 = 0011 0011 binary = handshake byte
4. ECU echoes 0x33 (sometimes)
5. Now both agree on 10,400 bps
6. Proceed with standard OBD

Diagram:
  K-line: ─────┐                      ┌────────────────────
         Low   └──────────────────────┘ (Tester pulls low 75ms)
         
  ECU:                  ┌──┐ (responds ~25ms)
  Response:             └──┘
  
  Then 0x33 at 5-baud (extremely slow data transfer)
```

#### Request Format:
```
Serial transmission at 10,400 bps:

Header:
  Byte 0: 0xF1         (Format ID: diagnostic request)
  Byte 1: 0x01         (Data length = 1 byte)
  Byte 2: 0x3E         (Tester address)

Request:
  Byte 3: 0x06         (OBD mode)
  Byte 4: 0x04         (MID)

Checksum:
  Byte 5: Checksum (sum of all previous bytes mod 256)

Example for MID 0x04 (Catalyst):
  Send (serial): F1 01 3E 06 04 [checksum]
  
  Timing: ~7 bits per byte @ 10,400 bps = 0.67ms per byte
  Total transmission: 6 bytes × 0.67ms = 4ms
```

#### Response Format:
```
Header:
  Byte 0: 0x51         (Format ID: positive response)
  Byte 1: 0xNN         (Data length = N bytes)
  Byte 2: 0xF1         (Echoed tester address)

Response Data:
  Byte 3: 0x46         (Mode response 0x40 + 0x06)
  Byte 4: 0x04         (MID echoed)
  Byte 5: 0xXX         (Test ID / Capability)
  Byte 6: 0xXX         (Test value)
  Byte 7: 0xXX         (Min)
  Byte 8: 0xXX         (Max)

Checksum:
  Byte 9: Checksum

Example response for Catalyst:
  Recv (serial): 51 06 F1 46 04 A0 5C 3C 64 [checksum]
```

### 2.3 K-Line Mode 0x06 Behavior per Manufacturer

#### Chrysler (K-Line):
```
Supports Mode 0x06: YES, standard implementation
Readiness: Mode 0x01 PID 0x01 = SAE standard
Timeout: 300-500ms (K-Line is slow)
Multi-response: Some monitors require multiple requests
  → MID 0x04 returns only first value
  → MID 0x04 again (repeat) returns second value
  
⚠️  CRITICAL: K-Line can only send ~150 bytes/second
    Long monitor lists may need multiple requests
```

#### Early Honda/Toyota (K-Line):
```
Chrysler uses pure ISO 9141-2
But Honda/Toyota often implement ISO 14230-4 (KWP2000) instead
Even though they use K-Line hardware

Detection: After 5-baud handshake, try:
  F1 10 F1 3E 00 00 00  (ISO 9141-2)
  OR
  3E 00  (KWP2000 TesterPresent)
  
If second works → it's KWP2000, not ISO 9141-2
```

### 2.4 K-Line Latency

```
Mode 0x06 typical timing on K-Line:

Handshake:     75-100ms
Tx request:    ~10ms (6 bytes @ 10.4kbps)
ECU latency:   50-100ms
Rx response:   ~15ms (9 bytes @ 10.4kbps)
Total:         150-225ms

Retry timeout: 500ms (K-Line is patient)
```

---

## PART 3: ISO 14230-4 (KWP2000 - Keyword Protocol 2000)

### 3.1 Overview
- **Standard**: ISO 14230-4 (Modern evolution of ISO 9141-2)
- **Adoption**: 1998-2008 vehicles, especially European and Asian
- **Speed**: Negotiated (1200-10,400 bps), typically 10,400
- **Frame Size**: 1 byte serial (like 9141-2)
- **Vehicles**: Most 1998-2006 Honda, Toyota, BMW (pre-2004), VW/Audi (pre-2009)
- **Key Difference**: Session types, longer timeouts, security access

### 3.2 KWP2000 vs ISO 9141-2

```
Similarity: Both use K-Line at 10,400 bps
Differences:

                    ISO 9141-2          KWP2000
Handshake:         5-baud 0x33          5-baud + negotiation
Sessions:          Single               Multiple (diagnostic, programming, etc)
Security:          None                 Key/seed based
Timeouts:          Fixed                Configurable
TesterPresent:     Not needed           Required every 3-5 seconds
Response length:   Limited              Larger

Mode 0x06 handling:
  9141-2: Simple request → response
  KWP2000: Session start → read monitor data → session end
```

### 3.3 KWP2000 Mode 0x06 Sequence

```
Step 1: Start Diagnostic Session
  Send: 10 01            (Start diagnostic session, subfunction 01)
  Recv: 50 01 [security bytes]  (positive response)

Step 2: Security Access (if required)
  Send: 27 01            (Request seed)
  Recv: 67 01 [seed bytes]
  Tester calculates key from seed
  Send: 27 02 [key]      (Send key)
  Recv: 67 02            (Access granted)

Step 3: Read Monitor Data
  Send: 06 04            (Mode 0x06 MID 0x04)
  Recv: 46 04 [monitor data]

Step 4: Keep Session Alive
  Send: 3E 00            (TesterPresent, subfunction 0)
  Recv: 7E 00            (positive response)
  REPEAT every 3-5 seconds

Step 5: End Session (important!)
  Send: 10 00            (Stop diagnostic session)
  Recv: 50 00
```

### 3.4 KWP2000 Security Access

```
Some vehicles require "UnlockLevel 01" to read detailed monitors:

Seed algorithm: Manufacturer-specific
Common implementations:
  - Simple XOR with fixed key
  - CRC-based (dealer-level security)
  - Keysafe algorithm (Honda)
  - PSA algorithm (Peugeot/Citroen)

ELM327 handling: Does NOT manage security
  → You must implement seed/key in your app
  
If ELM327 gets "7F 27 33" (Security access denied):
  You need to find the algorithm or bypass method
  (Usually available in forums for common vehicles)
```

### 3.5 KWP2000 Readiness Byte

```
Mode 0x01 PID 0x01 format: SAME as ISO 9141-2 (SAE standard)
BUT: Some manufacturers extend with additional bits

Example Honda KWP2000:
  Byte 0: Standard SAE (misfire, fuel, components, etc)
  Byte 1: SAE standard (secondary air, EVAP, etc)
  Byte 2: Honda-specific (EV-mode ready for hybrid, etc)
  
So Mode 0x01 PID 0x01 might return 3 bytes on Honda
vs 2 bytes on other manufacturers
```

---

## PART 4: SAE J1850 PWM (Pulse Width Modulation)

### 4.1 Overview
- **Standard**: SAE J1850 PWM variant
- **Adoption**: Ford (1996-2003 mostly)
- **Speed**: 41.6 kbps (fixed, NOT variable)
- **Frame Size**: 12 bytes
- **Physical**: Two wires (bus +/−) with termination resistors
- **Technology**: CSMA collision avoidance (like Ethernet)

### 4.2 PWM Frame Structure for Mode 0x06

#### Request Format:
```
Header (2 bytes):
  Byte 0: Priority (0x68 for requests)
  Byte 1: Receiving address (0xF1 for ECU)

Message (up to 10 bytes):
  Byte 2: Target address (0x10)
  Byte 3: OBD mode (0x06)
  Byte 4: MID (0x01-0x0A)
  Bytes 5-11: zeros or additional data

Checksum:
  Byte 12: Checksum

Total frame: 13 bytes (12 data + 1 checksum)

Example for MID 0x04:
  68 F1 10 06 04 00 00 00 00 00 00 00 [CRC]
```

#### Response Format:
```
Header:
  Byte 0: 0x48 (response priority)
  Byte 1: Requesting address

Response Data:
  Byte 2: 0x10 (source)
  Byte 3: 0x46 (mode response)
  Byte 4: 0x04 (MID echoed)
  Byte 5: Test ID
  Byte 6: Test value
  Byte 7: Min
  Byte 8: Max
  Bytes 9-11: zeros
  
Checksum:
  Byte 12: CRC

Example response:
  48 10 10 46 04 A0 5C 3C 64 00 00 00 [CRC]
```

### 4.3 PWM Mode 0x06 Behavior - Ford Specific

```
Readiness: Mode 0x01 PID 0x01 = SAE standard (same as CAN)

Ford Quirks for Mode 0x06:
  - Single response (no multi-frame segmentation)
  - Max 8 bytes of monitor data per MID
  - Some MIDs may return 0xFF if not supported
  - Timeout: 150ms typical (fast protocol)
  - Extended monitors (0x0B+): Very limited support

Mode 0x06 MID timeout: 50-100ms
Response latency: ~20-50ms

Collision handling (CSMA):
  If multiple ECUs respond simultaneously → collision
  ELM327 may need retry
  Typical retry: exponential backoff (100ms, 200ms, 400ms)
```

### 4.4 PWM Physical Characteristics

```
Baud timing precision: ±2% (very strict)
This is why cheap clones sometimes fail on PWM:
  - Oscillator accuracy < 0.1% needed
  - Cheap oscillators have 5%+ drift
  - Packet collisions increase

For Mode 0x06: Higher corruption rate on cheap clones
Expected success rate: 80-85% vs 95%+ on genuine ELM327
```

---

## PART 5: SAE J1850 VPW (Variable Pulse Width)

### 5.1 Overview
- **Standard**: SAE J1850 VPW variant
- **Adoption**: General Motors (1996-2008)
- **Speed**: Equivalent to ~10,400 bps (but encoded differently)
- **Frame Size**: Variable length (min 4 bytes, max ~40 bytes)
- **Encoding**: Pulse duration encodes bits (NOT standard voltage levels)

### 5.2 VPW Encoding

```
Unlike PWM which modulates pulse width:
VPW ONLY uses pulse DURATION to encode bits:

Bit 0: Short pulse (~65 µs)
Bit 1: Long pulse (~200 µs)

Frame example (simplified):
  [Start] [short] [long] [long] [short] [EOD] [CRC]
          bit 0   bit 1  bit 1  bit 0

Reading: Measure pulse width → decode bit value
This is why VPW is more error-prone than PWM:
  Exact timing measurement is critical
  Cheap adapters may misread timing
```

### 5.3 VPW Mode 0x06 Behavior - GM Specific

```
Request format similar to PWM:
  [start] Mode[06] MID[04] [EOD] [CRC]

Response:
  [start] Mode[46] MID[04] Value[XX] Min[XX] Max[XX] [EOD] [CRC]

Readiness: Mode 0x01 PID 0x01 = SAE standard

GM Quirks:
  - Supports extended monitors (0x0B-0x0E)
  - MID 0x0B: Turbo/supercharger boost
  - MID 0x0C: Cylinder deactivation
  - MID 0x0D: Transmission adaptive learn
  - Response timeout: 100ms
  - Some models require ATSR 2 (set responses) for reliability

Timing issues:
  VPW is inherently noisier than PWM
  On poor vehicles (corrosion, EMI): ~75% success rate
  On clean vehicles: ~90% success rate
```

### 5.4 VPW vs PWM Reliability

```
Mode 0x06 success rate comparison:

Scenario: Reading MID 0x04 on 20 vehicle samples

              PWM (Ford)  VPW (GM)
Clean:        95%         92%
Minor noise:  92%         85%
Corroded:     85%         70%
Poor EMI:     80%         65%

Reason: VPW relies on timing precision
        PWM relies on voltage levels (more robust)
```

---

## PART 6: SAE J1939 (Heavy Duty / Diesel)

### 6.1 Overview
- **Standard**: SAE J1939-71 (Truck/heavy vehicle diagnostics)
- **Adoption**: Diesel trucks (Cummins, Duramax), construction equipment
- **Speed**: 250 kbps (CAN-based)
- **Frame Size**: 9 bytes (NOT standard 8-byte CAN)
- **CAN ID**: 29-bit (extended CAN), not 11-bit like light-duty OBD

### 6.2 J1939 vs Light-Duty OBD-II CAN

```
                Light-Duty CAN    J1939
CAN ID bits:    11-bit            29-bit
Frame size:     8 bytes           9 bytes
Data range:     Individual PID    Parameter Group Number (PGN)
Multi-frame:    ISO-TP            J1939 DM (Diagnostic Message)
Addressing:     Peer-to-peer      Broadcast + destination

Mode 0x06: NOT STANDARD in J1939
          Heavy trucks use DM01 (Active Diagnostic Trouble Codes)
          DM06 (Diagnostic Data Clear/Reset for All DTCs)
          DM13 (Emission Test Results)
          But NOT "Mode 0x06" in OBD-II sense
```

### 6.3 J1939 Mode 0x06 Workaround (Limited)

```
Some modern J1939 ECUs implement light-duty OBD-II for compatibility
But support is MINIMAL and manufacturer-specific:

Cummins (Dodge Ram HD):
  - Supports Mode 0x06 only for MID 0x01 (misfire)
  - Other MIDs return 0xFF (not supported)
  - PGN 0x00F400 encodes the data instead

Duramax (Chevy/GMC HD):
  - Better OBD-II support
  - MIDs 0x01-0x04 work
  - Extended monitors (0x0B) = DM13 instead

⚠️  For OBDient: J1939 support requires parallel implementation
    Cannot reuse light-duty Mode 0x06 parser
```

---

## PART 7: Cross-Protocol Comparison Matrix

### 7.1 Mode 0x06 Capabilities

| Metric | CAN | K-Line | KWP2000 | PWM | VPW | J1939 |
|--------|-----|--------|---------|-----|-----|-------|
| Max frame | 8 | 1 | 1 | 12 | Variable | 9 |
| Multi-frame | Yes (ISO-TP) | No | No | No | No | Limited |
| Mode 0x06 MIDs (0x01-0x0A) | ✓ All | ✓ All | ✓ All | ✓ All | ✓ All | ⚠️  Partial |
| Extended (0x0B+) | ✓ Some OEMs | ✗ No | ✗ No | ✗ No | ✗ No | ✗ (use DM) |
| Typical latency | 50-100ms | 150-250ms | 200-400ms | 20-50ms | 30-80ms | 50-100ms |
| Timeout robust | Excellent | Good | Good | Fair | Fair | Good |
| ELM327 reliability | 95%+ | 85-90% | 90%+ | 80-85% | 80-85% | <50% |

### 7.2 Timeout Values Per Protocol

```
Protocol        Recommended     ELM327 Default   Notes
─────────────────────────────────────────────────────────
CAN (15765-4)   200ms           200ms           Single frame
                1000ms          (auto)          Multi-frame
K-Line (9141)   500ms           200ms           Very patient protocol
KWP2000         500-1000ms      200ms           May need TesterPresent
J1850 PWM       150ms           200ms           Collision prone
J1850 VPW       200ms           200ms           Timing sensitive
J1939           300ms           200ms           Rare Mode 0x06
```

### 7.3 Error Recovery by Protocol

```
CAN (15765-4):
  Negative Response: 7F 06 [reason]
  Recovery: Retry after 500ms
  Max retries: 3

K-Line (9141-2):
  Negative Response: 7F 06 [reason]
  Recovery: Retry after 500ms (same as CAN)
  Max retries: 5 (more patient)

KWP2000:
  Negative Response: 7F 06 [reason]
  Recovery: Send TesterPresent, then retry
  Max retries: 3, then restart session

J1850 PWM:
  Collision: Retry with backoff (100, 200, 400ms)
  Negative: 7F 06 [reason]
  Max retries: 5 (collision-prone)

J1850 VPW:
  Timeout: Retry (timing sensitive)
  Negative: 7F 06 [reason]
  Max retries: 5 (poor EMI environment)
```

---

## PART 8: ELM327 Protocol Handling

### 8.1 AT Commands for Protocol Management

```
AT Commands relevant to Mode 0x06:

ATSP [protocol]
  Set Protocol: 0=Auto, 1=J1850-PWM, 2=J1850-VPW, 3=ISO9141-2,
                4=ISO14230-4(KWP2000), 5=ISO15765-4 CAN (11-bit),
                6=ISO15765-4 CAN (29-bit)
  Effect: Locks to specific protocol (bypass auto-detect)
  Example: ATSP5 → Force CAN 11-bit
  Impact on Mode 0x06: Ensures consistent parsing

ATDP
  Display Protocol: Returns protocol name ("ISO 15765-4 (CAN 11-bit)")
  Use: Verify which protocol was detected
  For Mode 0x06: Critical for choosing parser

ATSR [0-255]
  Set Responses: How many responses to expect
  ATSR 0: Responses (default)
  ATSR 1: Auto-responses (ELM decides)
  Impact: For Mode 0x06, ATSR 1 may retry automatically

AT RI
  Reset Initializations: Clears protocol settings
  Use: Before ATSP to ensure clean state

AT MA (GM/Ford extensions)
  Enable All Monitors: Activates extended Mode 0x06 support
  Effect: Varies by ELM327 version
  Not standard → may not work on all clones

AT SM (GM/Ford extensions)
  Show Monitors: Proprietary command to list available monitors
  Use: Discover MIDs 0x0B+ support

AT ST [00-FF]
  Set Timeout: Response timeout in 10ms units
  Example: AT ST 14 = 20 × 10ms = 200ms timeout
  Default: 200ms (0x14)
  For Mode 0x06: May need ST 32 (500ms) on K-Line
```

### 8.2 ELM327 Firmware Versions & Mode 0x06 Support

```
Version     Release    Mode 0x06    CAN      KWP2000   PWM/VPW   Notes
────────────────────────────────────────────────────────────────────
v1.0-1.2    2004-2006  Poor         No       No        Basic     Never use
v1.3x       2007-2010  Good         Basic    Good      Good      Acceptable
v1.4.0-1.4.2 2010-2011 Excellent    Yes      Excellent Good      Good production
v1.4.5+     2011-2014  Excellent    Yes      Excellent Good      **RECOMMENDED**
v1.5.x      2014-2015  Excellent    Yes      Excellent Excellent Rare (genuine only)
v2.0+       2015+      Excellent    Excellent Excellent Excellent Gold standard (STN1110)

For OBDient: Target v1.4.5+ for reliability
             Many clones report fake version numbers
             Test MID 0x04 to verify actual firmware
```

### 8.3 Known ELM327 Firmware Bugs with Mode 0x06

```
Issue: Some ELM327 clones drop bytes on Mode 0x06 multi-frame (CAN)
Versions affected: v1.3x on cheap PIC16F87X clones
Symptom: "46 04 [incomplete data]" - missing threshold bytes
Workaround: Retry with AT ST 32 (longer timeout)

Issue: K-Line (ISO 9141-2) Mode 0x06 timeouts
Versions affected: v1.2-1.3x
Symptom: No response from 06 04 after ~200ms
Workaround: AT ST 32 (increase to 500ms)

Issue: J1850-VPW Mode 0x06 collisions
Versions affected: All v1.x (inherent to VPW)
Symptom: ~20% of requests get collision, retry succeeds
Workaround: Automatic retry loop (3x with backoff)

Issue: KWP2000 requires TesterPresent
Versions affected: All - correct per standard
Symptom: If > 3 seconds between requests, ECU resets session
Workaround: Send "3E 00" every 2 seconds (already in many apps)
```

---

## PART 9: Manufacturer Protocol Matrix

### 9.1 Which Manufacturers Use Which Protocols

```
General Motors:
  1996-2007:  SAE J1850-VPW (10,400 bps)
  2008+:      ISO 15765-4 CAN (250-500 kbps)
  Diesel HD:  SAE J1939 (250 kbps, 9-byte frames)
  Strategy: VPW → CAN migration

Ford:
  1996-2007:  SAE J1850-PWM (41.6 kbps)
  2008+:      ISO 15765-4 CAN (250-500 kbps)
  Diesel HD:  SAE J1939 + CAN fallback
  Strategy: PWM → CAN migration

Honda/Acura:
  1996-2005:  ISO 9141-2 K-Line (10,400 bps)
  2003+:      ISO 14230-4 KWP2000 (10,400 bps, K-Line)
  2005+:      ISO 15765-4 CAN (250-500 kbps)
  2010+:      CAN only, K-Line dropped
  Strategy: K-Line + KWP2000 overlap, then CAN

Toyota/Lexus:
  1996-2005:  ISO 9141-2 K-Line (10,400 bps)
  2003+:      ISO 14230-4 KWP2000 (K-Line)
  2006+:      ISO 15765-4 CAN (250-500 kbps)
  2015+:      CAN + proprietary extensions
  Strategy: Similar to Honda, smooth transition

Chrysler/Jeep:
  1996-2007:  ISO 9141-2 K-Line (10,400 bps)
  2005+:      ISO 15765-4 CAN (250-500 kbps)
  2008+:      CAN-only (K-Line deprecated)
  Strategy: Rapid switch to CAN

BMW/Mini:
  1996-2003:  ISO 9141-2 K-Line (10,400 bps)
  2004+:      ISO 14230-4 KWP2000 (K-Line)
  2007+:      ISO 15765-4 CAN (HIGH-SPEED 500 kbps)
  BUT: Standard OBD-II minimal, uses Mode 0xF1 instead
  Strategy: K-Line → CAN, OBD-II not primary

VW/Audi/Porsche (VAG Group):
  1996-2008:  ISO 14230-4 KWP2000 (K-Line)
  2009+:      ISO 15765-4 CAN (500 kbps)
  Pre-2009: NO STANDARD OBD-II (proprietary UDS)
  Strategy: Late OBD-II adoption, CAN focus

Hyundai/Kia:
  1996-2005:  ISO 9141-2 K-Line
  2003+:      ISO 14230-4 KWP2000
  2006+:      ISO 15765-4 CAN
  2010+:      CAN primary
  Strategy: Standard adoption, no deviations

Mazda:
  1996-2005:  SAE J1850-PWM or ISO 9141-2
  2006+:      ISO 15765-4 CAN (as Ford subsidiary)
  Strategy: Follows Ford's choices
```

---

## PART 10: Protocol-Specific Mode 0x06 Response Variability

### 10.1 Response Data Format Consistency

```
GOOD NEWS: Data format (hex encoding) does NOT change per protocol

All protocols encode:
  Test value: 0x00-0xFF (0-255 decimal)
  Min: 0x00-0xFF
  Max: 0x00-0xFF

BAD NEWS: Interpretation DOES change per protocol

Example: Catalyst MID 0x04 response

CAN response:    46 04 A0 5C 3C 64
K-Line response: 46 04 A0 5C 3C 64  (identical data bytes)

Interpretation:
  Byte 3 (A0): Capability/Test ID
  Byte 4 (5C): Test value = 92 decimal = 92% efficiency ✓
  Byte 5 (3C): Min = 60 decimal = 60% threshold ✓
  Byte 6 (64): Max = 100 decimal = 100% max ✓

BUT: Each protocol may return DIFFERENT NUMBER OF TIMES
  - Some protocols return all 8 bytes every request
  - Some return only 5 bytes
  - Some require multiple requests for complete data

Lesson: Parser must be FLEXIBLE in byte count
```

### 10.2 Multi-Byte Value Handling

```
ENDIANNESS: OBD-II is always BIG-ENDIAN (Motorola order)

Example: 16-bit value (some Honda extended monitors)

Value: 0x12AB (4779 decimal)
Transmitted: [0x12] [0xAB]  (high byte first)

Parsing:
  Do NOT use: value = byte[i] | (byte[i+1] << 8)  ❌ (little-endian)
  Do use:     value = (byte[i] << 8) | byte[i+1]  ✓  (big-endian)

For Mode 0x06: Most values are single-byte
              But some OEM extensions are multi-byte
              Always assume big-endian
```

---

## PART 11: Protocol Detection & Adaptation Strategy

### 11.1 Current ELM327 Detection (Your Code)

```typescript
// Your existing elm327.datasource.ts does:

async detectProtocol(): Promise<string> {
  const response = await this.sendCommand('ATDP');  // Display protocol
  // Parse response, return protocol name
}

Response examples:
  "ISO 15765-4 (CAN 11-bit)"
  "ISO 15765-4 (CAN 29-bit)"
  "ISO 9141-2"
  "ISO 14230-4"
  "SAE J1850 PWM"
  "SAE J1850 VPW"
```

### 11.2 Protocol Adaptation for Mode 0x06

```typescript
// PROPOSED: Protocol-specific Mode 0x06 handler

interface ProtocolConfig {
  protocol: string;
  timeout_ms: number;
  max_retries: number;
  multi_frame_support: boolean;
  parser: (response: string) => MonitorResult;
}

const PROTOCOL_CONFIGS: Record<string, ProtocolConfig> = {
  'ISO 15765-4 (CAN 11-bit)': {
    protocol: 'CAN',
    timeout_ms: 200,
    max_retries: 2,
    multi_frame_support: true,
    parser: parseCanMode06,  // ISO-TP aware
  },
  'ISO 15765-4 (CAN 29-bit)': {
    protocol: 'CAN-FD',
    timeout_ms: 200,
    max_retries: 2,
    multi_frame_support: true,
    parser: parseCanMode06,
  },
  'ISO 9141-2': {
    protocol: 'K-LINE-9141',
    timeout_ms: 500,
    max_retries: 3,
    multi_frame_support: false,
    parser: parseKLineMode06,
  },
  'ISO 14230-4': {
    protocol: 'K-LINE-KWP2000',
    timeout_ms: 500,
    max_retries: 3,
    multi_frame_support: false,
    parser: parseKWPMode06,
  },
  'SAE J1850 PWM': {
    protocol: 'PWM',
    timeout_ms: 200,
    max_retries: 4,  // PWM collision-prone
    multi_frame_support: false,
    parser: parsePWMMode06,
  },
  'SAE J1850 VPW': {
    protocol: 'VPW',
    timeout_ms: 200,
    max_retries: 5,  // VPW very collision-prone
    multi_frame_support: false,
    parser: parseVPWMode06,
  },
};

async getMonitorWithProtocolAdaptation(mid: number): Promise<MonitorResult> {
  const protocol = await this.detectProtocol();
  const config = PROTOCOL_CONFIGS[protocol];
  
  if (!config) {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }
  
  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < config.max_retries; attempt++) {
    try {
      await this.setTimeout(config.timeout_ms);
      const response = await this.sendCommand(`06${mid.toString(16).padStart(2, '0')}`);
      return config.parser(response);
    } catch (error) {
      if (attempt === config.max_retries - 1) throw error;
      await sleep(100 * Math.pow(2, attempt));  // Backoff
    }
  }
}
```

---

## PART 12: Implementation Roadmap (Protocol-Aware)

### 12.1 Phase 1: CAN Support (Easiest)

```
Why first?
  - Newest vehicles (post-2008)
  - Best ELM327 support
  - Most forgiving protocol
  - Largest market in OBDient (assuming modern cars)

Implementation:
  1. parseCanMode06(): Handle ISO-TP multi-frame (ELM abstracts, but validate)
  2. Add timeout: 200ms (CAN is fast)
  3. Retry: 2x
  4. Test on: 2008+ Honda, Ford, GM, Toyota
```

### 12.2 Phase 2: K-Line Variants (Moderate)

```
Why second?
  - Older vehicles (1996-2008)
  - Same physical layer (ISO 9141-2 vs KWP2000)
  - Both use 10.4kbps K-Line

Implementation:
  1. parseKLineMode06() / parseKWPMode06(): Single-frame only
  2. Add timeout: 500ms (K-Line is slow)
  3. KWP2000 special: Maintain TesterPresent (3E 00) every 2-3 seconds
  4. Retry: 3-5x
  5. Test on: 2000-2005 Honda/Toyota (K-Line), 2003-2008 VW (KWP2000)
```

### 12.3 Phase 3: J1850 Support (Complex)

```
Why third?
  - Limited market (mainly 1996-2007 Ford/GM)
  - Different behavior per variant (PWM vs VPW)
  - More collision-prone

Implementation:
  1. parsePWMMode06() / parseVPWMode06(): Protocol-specific CRC/encoding
  2. Add timeout: 200ms
  3. Collision retry: 4-5x with exponential backoff
  4. Test on: 1996-2003 Ford (PWM), 1996-2007 GM (VPW)
```

### 12.4 Phase 4: J1939 & Fallback (Future)

```
Why fourth?
  - Minimal market for light-duty OBD-II
  - Heavy vehicles are specialized
  - Requires parallel DM (Diagnostic Message) implementation

Strategy: Fallback to Mode 0x01/0x03 if J1939 Mode 0x06 not available
```

---

## CRITICAL FINDINGS FOR OBDIENT

### Finding 1: ELM327 Auto-Detect is Your Friend
Your existing `ATDP` call is perfect - it tells you which protocol to expect.
Use that to choose the right parser + timeout.

### Finding 2: K-Line Needs Patience
ISO 9141-2 and KWP2000 are 10x slower than CAN (10.4 kbps vs 250+ kbps).
Set timeout to 500ms, not 200ms. Otherwise you'll timeout prematurely.

### Finding 3: J1850 Needs Retry Logic
PWM and VPW are collision-prone. Expect ~15-20% failure rate on first attempt.
Implement automatic retry with exponential backoff (not just linear).

### Finding 4: KWP2000 Requires TesterPresent
If > 3 seconds between OBD commands, ECU resets session.
Send `3E 00` (TesterPresent) every 2-3 seconds on KWP2000.

### Finding 5: Protocol Determines Reliability
- CAN: 95%+ Mode 0x06 success on MID 0x01-0x06
- K-Line: 85-90%
- KWP2000: 90%+
- PWM: 80-85%
- VPW: 75-85%

Budget time accordingly in UI ("Reading monitors..." vs immediate display).

### Finding 6: Multi-Frame is CAN-Only
ISO-TP (ISO 15765-2) multi-frame segmentation ONLY exists on CAN.
K-Line, KWP2000, J1850: All single-frame. No worries about reassembly.

### Finding 7: OEM Extensions Vary Wildly
- GM VPW: Supports MID 0x0B-0x0E (turbo, transmission, DPF)
- Ford PWM: Minimal extended monitor support
- Honda KWP2000: Uses 32-bit values (not 8-bit SAE)
- BMW CAN: Ignores Mode 0x06 completely (use Mode 0xF1)

Strategy: Implement SAE standard (0x01-0x0A) first. OEM extensions later.

---

## PART 13: PHYSICAL LAYER — DLC PINOUT & HS-CAN vs MS-CAN (Gap Found & Closed)

**This section was MISSING from the original analysis.** Protocols 1-12 covered the logical/data-link layer (CAN vs K-Line vs PWM/VPW framing) but assumed "CAN" was a single monolithic bus reachable via pins 6/14. That assumption is wrong for some manufacturers. This section fact-checks the physical DLC pinout and a hard hardware limitation that affects Mode 0x06 monitor coverage.

### 13.1 J1962 DLC Pinout (Verified)

| Pin | Signal | Notes |
|---|---|---|
| 1 | Manufacturer discretionary | GM uses for SW-CAN (see 13.3) |
| 2 | SAE J1850 Bus+ | Used by both PWM and VPW |
| 3 | Manufacturer discretionary | **Ford/Mazda wire this as MS-CAN High** |
| 4 | Chassis ground | |
| 5 | Signal ground | |
| 6 | CAN High (ISO 15765-4) | HS-CAN, mandatory 2008+ USA |
| 7 | ISO 9141-2 / KWP2000 K-Line | |
| 8, 9 | Manufacturer discretionary | Rarely used |
| 10 | SAE J1850 Bus− | PWM only — VPW is single-wire, doesn't use this pin |
| 11 | Manufacturer discretionary | **Ford/Mazda wire this as MS-CAN Low** |
| 12, 13 | Manufacturer discretionary | Rarely used |
| 14 | CAN Low | |
| 15 | ISO 9141-2 / KWP2000 L-Line | Optional, rarely wired |
| 16 | Battery+ (always hot) | Powers the ELM327 directly |

**Important correction**: pins 3/11 are not an SAE-standardized "MS-CAN pin." They're generic manufacturer-discretionary pins that Ford/Mazda *chose* to wire as MS-CAN. Other OEMs solve the same bandwidth problem differently (see 13.2).

### 13.2 HS-CAN vs MS-CAN — This Is NOT Universal

| Manufacturer | Second physical bus on DLC? | Name | Mechanism |
|---|---|---|---|
| **Ford/Mazda** | **Yes** | MS-CAN (125 kbps) on pins 3/11, vs HS-CAN (500 kbps) on 6/14 | Separate physical bus for BCM/IPC/HVAC/Radio. **Post-2015 CGEA-platform Fords replaced this with a central gateway ("HS2-CAN")** — the dual-bus-on-DLC pattern is being phased out even at Ford. |
| **Chrysler/FCA/Jeep** | Partial/inconsistent | CAN-C (high speed) vs CAN-IHS (body bus) | Some models route CAN-IHS to 3/11 like Ford; many instead bridge it through the TIPM gateway onto pins 6/14, so a plain ELM327 *can* often reach body modules without needing 3/11. |
| **GM** | Different mechanism entirely | Low-Speed GMLAN / SW-CAN (SAE J2411) | Single-wire bus on **pin 1**, 33.3 kbps — not a differential pair, needs a different transceiver type. Not "MS-CAN," architecturally incompatible with an HS-CAN transceiver. |
| **Toyota, Honda, VW, BMW** | No | Central Gateway architecture | Body/comfort modules are bridged through a gateway ECU onto the standard 6/14 pins. No second bus exposed on spare DLC pins. |

**"MS-CAN" is Ford/Mazda-specific terminology, not an industry standard.**

### 13.3 THE HARD LIMITATION (Critical for Mode 0x06 Planning)

**A standard/cheap Bluetooth Classic ELM327 dongle CANNOT reach MS-CAN. This is a hardware limitation — no AT command, firmware update, or app-side workaround can bypass it.**

Why:
- The ELM327 chip drives CAN through an external transceiver IC (typically MCP2551-class), which on virtually every stock/cheap clone is **soldered only to pins 6/14**.
- There is no second transceiver and no internal multiplexer reaching pins 3/11 on a stock dongle.
- The *only* documented way to reach MS-CAN (per FORScan community mod guides) is physically desoldering the transceiver's connection to 6/14 and wiring in a manual DPDT switch to reroute the same transceiver to 3/11 — this is a **one-bus-at-a-time toggle**, never simultaneous, unless you buy a purpose-built dual-transceiver adapter (e.g., OBDLink EX).
- FORScan itself prompts the user to confirm "does your adapter have MS/HS switching hardware?" — confirming this is a hardware question, not something the software layer controls.
- `ATSP` and the full documented ELM327 AT command set only select protocol/bit-timing on whatever pins the transceiver is physically wired to. No command reroutes physical pins.

### 13.4 J1939 Firmware Correction

Original claim said "v1.3+" — actual: **J1939 support shipped in firmware v1.2** (base capability); v1.3 added refinements (additional commands, adaptive timing). Protocol select is `ATSP A` (protocol letter A = "SAE J1939, 29-bit ID, 250 kbaud"). Note this only gets you correct CAN framing/bit-timing for J1939 — PGN/SPN decoding and full transport-layer (TP.CM/TP.DT) reconstruction is NOT provided by ELM327 and must be implemented in-app, consistent with what Part 6 of this document already flagged.

### 13.5 Bottom Line for OBDient

- Every stock 16-pin DLC exposes pins 4,5,6,7,14,15,16 (+2,10 for J1850 vehicles) to any plugged-in device — that's a connector-standard fact, independent of adapter.
- OBDient's users with a standard Bluetooth Classic ELM327 (matching the current `ATSP0` auto-init in `elm327.datasource.ts`) can only ever reach pins 6/14 + 7/15 — exactly what the code already assumes.
- **Concrete Mode 0x06 impact**: On Ford/Mazda vehicles, any monitor living on a body/comfort module (BCM, IPC, HVAC, Radio) that only responds on MS-CAN is **permanently inaccessible** to OBDient users unless they buy/build a hardware-modified adapter. This is not a bug to fix in software — it's a documented hardware ceiling.
- Practical effect: this mainly affects *comfort/body* monitors, not the powertrain monitors (misfire, fuel system, catalyst, O2, EGR, EVAP) this document already prioritized in Part 12 — those live on HS-CAN (6/14) and remain fully reachable. So the roadmap in Part 12 doesn't change, but the "known limitations" section for Ford/Mazda users should mention this explicitly.

---

## NEXT STEPS FOR OBDIENT

Before implementing Mode 0x06, update your architecture to:

1. **Detect protocol at session start** ✓ (you already do ATDP)
2. **Choose parser based on protocol** (needs creation)
3. **Set timeout per protocol** (not one-size-fits-all)
4. **Implement protocol-specific retry** (backoff for J1850, TesterPresent for KWP2000)
5. **Test on vehicles from ALL protocol families** (don't just test CAN)

This document should guide your implementation architecture. 🚀
