// OBD-II diagnostic knowledge base for on-device RAG.
//
// Each entry is a self-contained paragraph (DTC meaning + common causes +
// recommended action + severity) so the embedder can retrieve it independently.
// This is the corpus indexed into the QVAC RAG vector store at first launch.
// To extend the knowledge, add entries and bump KNOWLEDGE_VERSION.

export const KNOWLEDGE_VERSION = 4;

export interface KnowledgeDoc {
  readonly id: string;
  readonly content: string;
  // SKOS concept this document belongs to (canonical node in obd-ontology.ts)
  readonly conceptId: string;
}

export const OBD_KNOWLEDGE: readonly KnowledgeDoc[] = [
  {
    id: 'P0300',
    conceptId: 'misfire_random',
    content:
      'DTC P0300 — Random/Multiple Cylinder Misfire Detected. The engine is ' +
      'misfiring on more than one cylinder. Common causes: worn spark plugs or ' +
      'coils, vacuum leaks, low fuel pressure, clogged injectors, or low ' +
      'compression. Action: inspect ignition components and fuel delivery; avoid ' +
      'hard acceleration. Severity: high — prolonged misfire can damage the ' +
      'catalytic converter.',
  },
  {
    id: 'P0301-P0308',
    conceptId: 'misfire_cylinder',
    content:
      'DTC P0301 through P0308 — Cylinder-specific misfire (the last digit is the ' +
      'cylinder number, e.g. P0304 = cylinder 4). Causes: faulty spark plug or ' +
      'coil on that cylinder, injector, or compression loss. Action: swap the coil/' +
      'plug with an adjacent cylinder to see if the misfire follows. Severity: high.',
  },
  {
    id: 'P0171-P0174',
    conceptId: 'fuel_lean',
    content:
      'DTC P0171/P0174 — System Too Lean (Bank 1/Bank 2). Too much air or too ' +
      'little fuel. Causes: vacuum/intake leaks, dirty MAF sensor, weak fuel pump, ' +
      'clogged injectors, or a faulty oxygen sensor. Action: check for intake ' +
      'leaks and clean the MAF sensor. Severity: medium.',
  },
  {
    id: 'P0172-P0175',
    conceptId: 'fuel_rich',
    content:
      'DTC P0172/P0175 — System Too Rich (Bank 1/Bank 2). Too much fuel. Causes: ' +
      'leaking injectors, high fuel pressure, dirty MAF, or a faulty coolant temp ' +
      'sensor. Action: inspect fuel pressure and injectors. Severity: medium.',
  },
  {
    id: 'P0420-P0430',
    conceptId: 'catalyst',
    content:
      'DTC P0420/P0430 — Catalyst System Efficiency Below Threshold (Bank 1/Bank ' +
      '2). The catalytic converter is not working efficiently. Causes: aged ' +
      'catalytic converter, faulty downstream oxygen sensor, or an exhaust leak. ' +
      'Often triggered after an unresolved misfire. Action: verify O2 sensors ' +
      'before replacing the converter. Severity: medium.',
  },
  {
    id: 'P0128',
    conceptId: 'sensor_temperature',
    content:
      'DTC P0128 — Coolant Thermostat below regulating temperature. The engine is ' +
      'not reaching normal operating temperature. Cause: stuck-open thermostat. ' +
      'Action: replace the thermostat. Severity: low.',
  },
  {
    id: 'P0442-P0455',
    conceptId: 'evap',
    content:
      'DTC P0442/P0455 — EVAP System Leak Detected (small/large). A leak in the ' +
      'evaporative emissions system. Most common cause: a loose, damaged, or ' +
      'missing fuel cap. Action: check and retighten the fuel cap first. ' +
      'Severity: low.',
  },
  {
    id: 'P0401',
    conceptId: 'egr',
    content:
      'DTC P0401 — Exhaust Gas Recirculation (EGR) Flow Insufficient. Causes: ' +
      'clogged EGR passages, stuck EGR valve, or a faulty DPFE sensor. Action: ' +
      'clean or replace the EGR valve. Severity: medium.',
  },
  {
    id: 'P0113-P0118',
    conceptId: 'sensor_temperature',
    content:
      'DTC P0113 (Intake Air Temp) / P0118 (Engine Coolant Temp) — sensor circuit ' +
      'high input. A temperature sensor is reading out of range. Causes: failed ' +
      'sensor or wiring/connector fault. Action: inspect the sensor connector and ' +
      'resistance. Severity: low to medium.',
  },
  {
    id: 'P0500',
    conceptId: 'sensor_speed',
    content:
      'DTC P0500 — Vehicle Speed Sensor (VSS) malfunction. Causes: faulty speed ' +
      'sensor, damaged wiring, or a bad connection. Action: inspect the VSS and ' +
      'its wiring. Severity: medium.',
  },
  {
    id: 'P0700',
    conceptId: 'transmission',
    content:
      'DTC P0700 — Transmission Control System malfunction. This is a generic code ' +
      'indicating the transmission control module has stored a fault; read the ' +
      'manufacturer-specific P07xx/P box codes for detail. Action: scan ' +
      'transmission sub-codes. Severity: medium to high.',
  },
  {
    id: 'dtc-prefixes',
    conceptId: 'powertrain',
    content:
      'OBD-II DTC prefixes: P = Powertrain (engine/transmission), B = Body, C = ' +
      'Chassis, U = Network/communication. The second character 0 means a generic ' +
      'SAE code; 1 means a manufacturer-specific code. Pxxxx codes are the most ' +
      'common for engine diagnostics.',
  },
  {
    id: 'cond-overheat',
    conceptId: 'live_overheat',
    content:
      'Live condition — High coolant temperature (overheating). Coolant above ' +
      'about 105-110 C is dangerous. Causes: low coolant, failed water pump, ' +
      'stuck thermostat, bad radiator fan, or head gasket failure. Action: stop ' +
      'the vehicle safely and let it cool; do not open the cap while hot. ' +
      'Severity: critical.',
  },
  {
    id: 'cond-voltage',
    conceptId: 'live_voltage',
    content:
      'Live condition — Low battery/system voltage. With the engine running, ' +
      'charging voltage should be roughly 13.5-14.5 V. Below ~12.5 V running ' +
      'suggests the alternator is not charging. Causes: failing alternator, worn ' +
      'belt, or bad battery. Action: test the charging system. Severity: high.',
  },
  {
    id: 'cond-rpm',
    conceptId: 'live_rpm',
    content:
      'Live condition — Very high engine RPM. Sustained high RPM increases wear ' +
      'and heat. If RPM is high at idle, suspect a vacuum leak or idle air ' +
      'control problem. Action: ease off the throttle; check for intake leaks at ' +
      'idle. Severity: medium.',
  },

  // ── Fuel delivery ────────────────────────────────────────────────────────
  {
    id: 'P0087',
    conceptId: 'fuel_delivery',
    content:
      'DTC P0087 — Fuel Rail/System Pressure Too Low. The ECU detects fuel ' +
      'pressure below the minimum threshold for proper combustion. Engine will ' +
      'stall or surge under load. Causes: clogged fuel filter (most common), ' +
      'failing fuel pump, faulty fuel pressure regulator, or a kinked fuel line. ' +
      'Action: replace the fuel filter first; if pressure is still low, test the ' +
      'fuel pump output pressure. Do not drive — the engine can stall without ' +
      'warning. Severity: critical.',
  },
  {
    id: 'P0088',
    conceptId: 'fuel_delivery',
    content:
      'DTC P0088 — Fuel Rail/System Pressure Too High. Fuel pressure exceeds the ' +
      'upper limit. Causes: stuck-closed fuel pressure regulator, blocked return ' +
      'line, or a faulty fuel pressure sensor. Action: measure actual rail ' +
      'pressure with a gauge; replace the regulator or return line as indicated. ' +
      'Severity: high — overpressure can cause rich running and injector damage.',
  },

  // ── O2 / lambda sensors ──────────────────────────────────────────────────
  {
    id: 'P0130-P0167',
    conceptId: 'sensor_o2',
    content:
      'DTC P0130–P0167 — Oxygen Sensor circuit faults (Banks 1/2, Sensors 1/2). ' +
      'The upstream (pre-cat) O2 sensor drives fuel trim; the downstream (post-cat) ' +
      'monitors catalyst efficiency. Causes: aged sensor (replace every 100 k km), ' +
      'exhaust leaks before the sensor, contamination from coolant or oil burn. ' +
      'Action: inspect wiring first; replace the sensor if signal is fixed or ' +
      'sluggish. Severity: medium — degraded fuel economy and possible catalyst damage.',
  },
  {
    id: 'P0562',
    conceptId: 'live_voltage',
    content:
      'DTC P0562 — System Voltage Low. The PCM detects battery/system voltage ' +
      'below roughly 10 V for an extended period. This is different from a brief ' +
      'voltage dip; it indicates a sustained charging failure. Causes: failing ' +
      'alternator, loose or corroded battery terminals, a parasitic drain, or a ' +
      'failing battery. Action: test charging output with engine running; check ' +
      'belt tension and alternator output. Severity: high — electrical components ' +
      'will malfunction and the engine may die.',
  },

  // ── Timing & VVT ────────────────────────────────────────────────────────
  {
    id: 'P0011',
    conceptId: 'vvt',
    content:
      'DTC P0011 — Camshaft Position A — Timing Over-Advanced or System ' +
      'Performance (Bank 1). The variable valve timing (VVT) system has advanced ' +
      'the cam beyond the commanded angle. Root cause is almost always an oil ' +
      'problem: low level, dirty oil blocking the VVT solenoid, or wrong viscosity. ' +
      'Action: change the engine oil and filter immediately and clear the code — ' +
      'this resolves the majority of P0011 cases. If it returns, inspect the VVT ' +
      'solenoid and timing chain stretch. Do not drive; timing chain damage can ' +
      'be catastrophic. Severity: high.',
  },
  {
    id: 'P0012',
    conceptId: 'vvt',
    content:
      'DTC P0012 — Camshaft Position A — Timing Over-Retarded (Bank 1). The VVT ' +
      'system cannot advance the cam to the target angle, or it is stuck retarded. ' +
      'Causes: same oil-quality issues as P0011 (dirty oil, low pressure), stuck ' +
      'VVT solenoid, or stretched timing chain. Action: change oil first; test VVT ' +
      'solenoid resistance (~6–8 Ω typical). Severity: high.',
  },
  {
    id: 'P0016',
    conceptId: 'timing_correlation',
    content:
      'DTC P0016 — Crankshaft Position / Camshaft Position Correlation Error ' +
      '(Bank 1, Sensor A). The crank and cam sensors disagree on timing, meaning ' +
      'the timing chain may have jumped a tooth. This is a critical fault — a ' +
      'jumped chain can cause bent valves and catastrophic engine damage on ' +
      'interference engines. Action: do not start the engine again; inspect the ' +
      'timing chain, tensioner, and guides. Check oil level immediately — low oil ' +
      'pressure accelerates chain wear. Severity: critical.',
  },
  {
    id: 'P0017',
    conceptId: 'timing_correlation',
    content:
      'DTC P0017 — Crankshaft / Camshaft Position Correlation Error (Bank 1, ' +
      'Sensor B — exhaust cam). Same root cause as P0016 but on the exhaust ' +
      'camshaft. Often appears together with P0016 when a dual-cam timing chain ' +
      'has jumped. Action: inspect timing chain immediately; do not drive. ' +
      'Severity: critical.',
  },

  // ── Crankshaft / Camshaft position sensors ──────────────────────────────
  {
    id: 'P0335-P0338',
    conceptId: 'sensor_crank',
    content:
      'DTC P0335–P0338 — Crankshaft Position Sensor A/B circuit fault. No or ' +
      'erratic crank signal means the ECU cannot determine engine position and ' +
      'will not allow starting (or the engine will stall). Causes: failed sensor, ' +
      'damaged reluctor wheel (missing tooth), or broken wiring. Action: check ' +
      'wiring and connector first; replace the sensor if signal is absent on ' +
      'oscilloscope. Do not drive — engine will stall without warning. ' +
      'Severity: critical.',
  },
  {
    id: 'P0340-P0349',
    conceptId: 'sensor_cam',
    content:
      'DTC P0340–P0349 — Camshaft Position Sensor A/B circuit fault (Banks 1/2). ' +
      'Missing cam signal causes rough running, hard starting, and potential ' +
      'stalling. Causes: failed cam sensor, damaged tone wheel, wiring fault, or ' +
      'stretched timing chain altering cam position. Action: verify wiring and ' +
      'connector; if wiring is good, replace the sensor. Check for timing chain ' +
      'issues if the code returns. Severity: high.',
  },

  // ── Knock / detonation ───────────────────────────────────────────────────
  {
    id: 'P0325-P0334',
    conceptId: 'sensor_knock',
    content:
      'DTC P0325–P0334 — Knock Sensor circuit fault (Banks 1/2). The knock ' +
      'sensor detects engine detonation; a fault causes the ECU to retard timing ' +
      'as a precaution, reducing power and economy. Causes: failed knock sensor, ' +
      'damaged harness (sensor is under the intake manifold on many engines), or ' +
      'actual detonation from low-octane fuel or carbon buildup. Action: inspect ' +
      'wiring first; if signal is missing, replace the sensor. Use correct fuel ' +
      'octane. Severity: medium.',
  },

  // ── MAF sensor ──────────────────────────────────────────────────────────
  {
    id: 'P0100-P0104',
    conceptId: 'sensor_maf',
    content:
      'DTC P0100–P0104 — Mass Air Flow (MAF) sensor circuit fault. The MAF ' +
      'measures incoming air mass; a fault sends incorrect data to the fuel ' +
      'injection system causing rich/lean running and rough idle. Causes: dirty ' +
      'or contaminated MAF element (clean with MAF-safe spray), air leak between ' +
      'MAF and throttle body, damaged wiring, or failed sensor. Action: clean the ' +
      'MAF first; if the code returns, replace the sensor. Severity: medium.',
  },

  // ── Throttle body / pedal ────────────────────────────────────────────────
  {
    id: 'P0120-P0124',
    conceptId: 'throttle',
    content:
      'DTC P0120–P0124 — Throttle/Pedal Position Sensor A circuit fault. The TPS ' +
      'signal is used for throttle control; a fault can cause hesitation, surging, ' +
      'or limp mode. Causes: dirty or worn TPS, wiring fault, or a failing ' +
      'throttle body. Action: clean the throttle body; check wiring; replace the ' +
      'TPS or throttle body assembly if signal is erratic. Severity: medium to high.',
  },
  {
    id: 'P0221-P0229',
    conceptId: 'throttle',
    content:
      'DTC P0221–P0229 — Throttle/Pedal Position Sensor B circuit fault. Second ' +
      'TPS channel (drive-by-wire systems use dual sensors for redundancy). A ' +
      'discrepancy between channels A and B puts the system into limp mode. ' +
      'Action: inspect connector and wiring; replace throttle body assembly if ' +
      'both channels disagree consistently. Severity: high.',
  },

  // ── Turbocharger / supercharger ──────────────────────────────────────────
  {
    id: 'P0234',
    conceptId: 'turbo',
    content:
      'DTC P0234 — Turbocharger/Supercharger Over Boost Condition. Boost pressure ' +
      'exceeds the maximum limit. Causes: stuck-open wastegate or bypass valve, ' +
      'faulty boost pressure sensor, or a boost leak allowing incorrect MAP ' +
      'readings. Action: check wastegate actuator operation; inspect boost hoses ' +
      'for leaks. Severity: high — overboost can cause engine damage.',
  },
  {
    id: 'P0299',
    conceptId: 'turbo',
    content:
      'DTC P0299 — Turbocharger/Supercharger Under Boost Condition. Boost is ' +
      'below the target. Causes: boost/intake leak (most common — check all ' +
      'couplers and intercooler hoses), faulty wastegate stuck open, worn turbo ' +
      'vanes, or a failing boost pressure sensor. Action: smoke test the charge ' +
      'air system first; inspect wastegate actuator travel. Severity: medium — ' +
      'significant power loss; can indicate turbo wear.',
  },

  // ── EVAP extended ────────────────────────────────────────────────────────
  {
    id: 'P0440-P0441',
    conceptId: 'evap',
    content:
      'DTC P0440 / P0441 — EVAP System malfunction / incorrect purge flow. ' +
      'P0440 is a general EVAP fault; P0441 indicates the purge solenoid is not ' +
      'flowing as commanded. Causes: faulty purge solenoid, stuck-closed vent ' +
      'valve, or a loose gas cap. Action: check purge solenoid activation with a ' +
      'scan tool; inspect vent valve. Severity: low — no immediate drivability ' +
      'risk but will fail emissions test.',
  },

  // ── EGR extended ────────────────────────────────────────────────────────
  {
    id: 'P0402-P0409',
    conceptId: 'egr',
    content:
      'DTC P0402–P0409 — EGR Flow Excessive / EGR sensor circuit faults. P0402 ' +
      'means too much EGR gas is entering, causing rough idle and stumbling. ' +
      'P040x sensor codes indicate the DPFE or EGR position sensor has failed. ' +
      'Action: clean EGR passages; inspect DPFE hoses for cracks; replace the ' +
      'DPFE sensor if signal is erratic. Severity: medium.',
  },

  // ── Transmission extended ────────────────────────────────────────────────
  {
    id: 'P0715-P0720',
    conceptId: 'transmission',
    content:
      'DTC P0715–P0720 — Transmission Input/Output Speed Sensor circuit fault. ' +
      'The TCM cannot calculate gear ratio, causing harsh shifts, slipping, or ' +
      'no gear engagement. Causes: failed speed sensor, wiring fault, or metal ' +
      'debris on the sensor tip. Action: inspect sensor tip for contamination; ' +
      'check wiring; replace sensor. Severity: high.',
  },
  {
    id: 'P0730-P0736',
    conceptId: 'transmission',
    content:
      'DTC P0730–P0736 — Incorrect Gear Ratio detected (1st–5th gear). The TCM ' +
      'commanded a gear but the ratio feedback does not match. Causes: worn ' +
      'clutch packs, faulty shift solenoid, low or degraded ATF, or internal ' +
      'mechanical damage. Action: check ATF level and condition first; perform a ' +
      'solenoid functional test with a scan tool. Severity: high.',
  },

  // ── Live conditions extended ─────────────────────────────────────────────
  {
    id: 'cond-fuel-pressure',
    conceptId: 'fuel_delivery',
    content:
      'Live condition — Low fuel rail pressure with no DTC yet. If RPM drops ' +
      'under load and fuel pressure reads low on a scan tool, the pump is ' +
      'struggling before the ECU logs a fault. Common on high-mileage vehicles. ' +
      'Action: measure static and running pressure; replace pump if below spec. ' +
      'Severity: high.',
  },
  {
    id: 'cond-oil-pressure',
    conceptId: 'live_oil',
    content:
      'Live condition — Low engine oil pressure. Oil pressure below ~1 bar at idle ' +
      '(or the warning light illuminates) is an emergency. Causes: low oil level ' +
      '(check dipstick immediately), worn oil pump, blocked pickup screen, or ' +
      'worn main/rod bearings. Action: stop the engine immediately; do not restart ' +
      'until oil level and pressure are verified. Severity: critical.',
  },
  // P23xx: Diesel Fuel Injection Pump Metering Control (Common Rail / Mechanical)
  {
    id: 'P2300',
    conceptId: 'diesel_injection_pump',
    content:
      'DTC P2300 — Injection Pump Fuel Metering Control A Circuit Malfunction. The ' +
      'fuel injection pump control solenoid/actuator is not responding correctly. ' +
      'Common on diesel engines with mechanical injection pumps (Bosch, Delphi, ' +
      'Stanadyne). Causes: faulty solenoid valve, wiring harness damage, fuel line ' +
      'blockage, or injection pump ECU failure. Action: verify fuel pressure and ' +
      'solenoid voltage; scan for secondary faults. Severity: critical — engine may ' +
      'not start or run rough.',
  },
  {
    id: 'P2302',
    conceptId: 'diesel_injection_pump',
    content:
      'DTC P2302 — Injection Pump Fuel Metering Control A Circuit Low. The injection ' +
      'pump metering solenoid voltage or control signal is below expected range. This ' +
      'is a critical diesel fault indicating loss of fuel delivery control. Causes: ' +
      'short to ground in the solenoid circuit, corroded connectors, broken wiring, ' +
      'or PCM/ECM output stage failure. Action: check connector health, measure ' +
      'resistance on the solenoid (typ. 4-20 ohms), and scan for related P2300/P2301 ' +
      'codes. Severity: critical — engine will likely stall or not start.',
  },
  {
    id: 'P2303',
    conceptId: 'diesel_injection_pump',
    content:
      'DTC P2303 — Injection Pump Fuel Metering Control B Circuit Malfunction. The ' +
      'secondary or redundant metering solenoid is faulty. Similar to P2300 but on a ' +
      'different solenoid valve (pump may have two control stages). Causes: solenoid ' +
      'coil open/shorted, wiring harness fault, or fuel line restriction. Action: ' +
      'trace both solenoid circuits; check for P2304/P2305 for more specific faults. ' +
      'Severity: critical.',
  },
  {
    id: 'P2304-P2305',
    conceptId: 'diesel_injection_pump',
    content:
      'DTC P2304/P2305 — Injection Pump Metering Control B High/Low. Companion codes ' +
      'to P2303, indicating the secondary solenoid voltage is too high or too low. ' +
      'Diagnosis: same as P2300/P2302 but on the B circuit. Check for split or ' +
      'miswired connectors between the pump and ECM. Severity: critical.',
  },
  {
    id: 'P2306-P2308',
    conceptId: 'diesel_injection_pump',
    content:
      'DTC P2306/P2307/P2308 — Injection Pump Metering Control C Circuit. Some large ' +
      'diesel engines (e.g. Cummins, Detroit) may have three metering stages. These ' +
      'codes follow the same pattern: verify solenoid coils, wiring harness, fuel ' +
      'line routing, and fuel delivery quality. Multi-stage faults often indicate a ' +
      'systemic issue (fuel contamination, high-pressure regulator, or injection ' +
      'pump wear). Severity: critical.',
  },
  {
    id: 'P2510-P2519',
    conceptId: 'diesel_glow_plugs',
    content:
      'DTC P2510–P2519 — Idle Air Control / Glow Plug System Malfunction. On diesel ' +
      'engines, glow plugs provide cold-start heat. These codes indicate issues with ' +
      'the glow plug timer relay, control module, or individual glow plug circuits. ' +
      'Causes: failed relay, broken glow plugs, wiring faults, or PCM communication ' +
      'loss. Action: measure voltage at glow plugs (12V nominal during crank), and ' +
      'check relay continuity. Severity: medium to critical — cold starts will be ' +
      'difficult in winter.',
  },
  {
    id: 'P2521-P2529',
    conceptId: 'diesel_particulate_filter',
    content:
      'DTC P2521–P2529 — Diesel Particulate Filter (DPF) Regeneration Faults. Modern ' +
      'diesel engines trap soot in a DPF; the engine actively burns it off (active ' +
      'regeneration) periodically. These codes mean regeneration is inhibited or ' +
      'failed. Causes: low engine temp, high water content in fuel, transmission ' +
      'shifting during regen, or excessive soot buildup. Action: allow a forced ' +
      'regeneration cycle via scan tool; check for contaminated fuel or oil change ' +
      'intervals. Severity: medium — prolonged backpressure can stall the engine.',
  },
];

