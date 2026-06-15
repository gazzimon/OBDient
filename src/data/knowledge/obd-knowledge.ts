// OBD-II diagnostic knowledge base for on-device RAG.
//
// Each entry is a self-contained paragraph (DTC meaning + common causes +
// recommended action + severity) so the embedder can retrieve it independently.
// This is the corpus indexed into the QVAC RAG vector store at first launch.
// To extend the knowledge, add entries and bump KNOWLEDGE_VERSION.

export const KNOWLEDGE_VERSION = 1;

export interface KnowledgeDoc {
  readonly id: string;
  readonly content: string;
}

export const OBD_KNOWLEDGE: readonly KnowledgeDoc[] = [
  {
    id: 'P0300',
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
    content:
      'DTC P0301 through P0308 — Cylinder-specific misfire (the last digit is the ' +
      'cylinder number, e.g. P0304 = cylinder 4). Causes: faulty spark plug or ' +
      'coil on that cylinder, injector, or compression loss. Action: swap the coil/' +
      'plug with an adjacent cylinder to see if the misfire follows. Severity: high.',
  },
  {
    id: 'P0171-P0174',
    content:
      'DTC P0171/P0174 — System Too Lean (Bank 1/Bank 2). Too much air or too ' +
      'little fuel. Causes: vacuum/intake leaks, dirty MAF sensor, weak fuel pump, ' +
      'clogged injectors, or a faulty oxygen sensor. Action: check for intake ' +
      'leaks and clean the MAF sensor. Severity: medium.',
  },
  {
    id: 'P0172-P0175',
    content:
      'DTC P0172/P0175 — System Too Rich (Bank 1/Bank 2). Too much fuel. Causes: ' +
      'leaking injectors, high fuel pressure, dirty MAF, or a faulty coolant temp ' +
      'sensor. Action: inspect fuel pressure and injectors. Severity: medium.',
  },
  {
    id: 'P0420-P0430',
    content:
      'DTC P0420/P0430 — Catalyst System Efficiency Below Threshold (Bank 1/Bank ' +
      '2). The catalytic converter is not working efficiently. Causes: aged ' +
      'catalytic converter, faulty downstream oxygen sensor, or an exhaust leak. ' +
      'Often triggered after an unresolved misfire. Action: verify O2 sensors ' +
      'before replacing the converter. Severity: medium.',
  },
  {
    id: 'P0128',
    content:
      'DTC P0128 — Coolant Thermostat below regulating temperature. The engine is ' +
      'not reaching normal operating temperature. Cause: stuck-open thermostat. ' +
      'Action: replace the thermostat. Severity: low.',
  },
  {
    id: 'P0442-P0455',
    content:
      'DTC P0442/P0455 — EVAP System Leak Detected (small/large). A leak in the ' +
      'evaporative emissions system. Most common cause: a loose, damaged, or ' +
      'missing fuel cap. Action: check and retighten the fuel cap first. ' +
      'Severity: low.',
  },
  {
    id: 'P0401',
    content:
      'DTC P0401 — Exhaust Gas Recirculation (EGR) Flow Insufficient. Causes: ' +
      'clogged EGR passages, stuck EGR valve, or a faulty DPFE sensor. Action: ' +
      'clean or replace the EGR valve. Severity: medium.',
  },
  {
    id: 'P0113-P0118',
    content:
      'DTC P0113 (Intake Air Temp) / P0118 (Engine Coolant Temp) — sensor circuit ' +
      'high input. A temperature sensor is reading out of range. Causes: failed ' +
      'sensor or wiring/connector fault. Action: inspect the sensor connector and ' +
      'resistance. Severity: low to medium.',
  },
  {
    id: 'P0500',
    content:
      'DTC P0500 — Vehicle Speed Sensor (VSS) malfunction. Causes: faulty speed ' +
      'sensor, damaged wiring, or a bad connection. Action: inspect the VSS and ' +
      'its wiring. Severity: medium.',
  },
  {
    id: 'P0700',
    content:
      'DTC P0700 — Transmission Control System malfunction. This is a generic code ' +
      'indicating the transmission control module has stored a fault; read the ' +
      'manufacturer-specific P07xx/P box codes for detail. Action: scan ' +
      'transmission sub-codes. Severity: medium to high.',
  },
  {
    id: 'dtc-prefixes',
    content:
      'OBD-II DTC prefixes: P = Powertrain (engine/transmission), B = Body, C = ' +
      'Chassis, U = Network/communication. The second character 0 means a generic ' +
      'SAE code; 1 means a manufacturer-specific code. Pxxxx codes are the most ' +
      'common for engine diagnostics.',
  },
  {
    id: 'cond-overheat',
    content:
      'Live condition — High coolant temperature (overheating). Coolant above ' +
      'about 105-110 C is dangerous. Causes: low coolant, failed water pump, ' +
      'stuck thermostat, bad radiator fan, or head gasket failure. Action: stop ' +
      'the vehicle safely and let it cool; do not open the cap while hot. ' +
      'Severity: critical.',
  },
  {
    id: 'cond-voltage',
    content:
      'Live condition — Low battery/system voltage. With the engine running, ' +
      'charging voltage should be roughly 13.5-14.5 V. Below ~12.5 V running ' +
      'suggests the alternator is not charging. Causes: failing alternator, worn ' +
      'belt, or bad battery. Action: test the charging system. Severity: high.',
  },
  {
    id: 'cond-rpm',
    content:
      'Live condition — Very high engine RPM. Sustained high RPM increases wear ' +
      'and heat. If RPM is high at idle, suspect a vacuum leak or idle air ' +
      'control problem. Action: ease off the throttle; check for intake leaks at ' +
      'idle. Severity: medium.',
  },
];
