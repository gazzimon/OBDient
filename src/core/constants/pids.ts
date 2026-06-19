// OBD-II PID definitions with real formulas, units, ranges, and alert thresholds.
// Formulas use byte variables A and B as returned by the ELM327 adapter.
// Alert thresholds of null mean no automatic alert is configured for that PID.

export type PidId =
  | 'RPM' | 'SPEED' | 'COOLANT_TEMP' | 'ENGINE_LOAD' | 'MAF' | 'TPS' | 'IAT' | 'VOLTAGE'
  | 'FUEL_TRIM_SHORT' | 'FUEL_TRIM_LONG' | 'TIMING_ADVANCE' | 'INTAKE_MAP'
  | 'O2_B1S1' | 'O2_B1S2' | 'RUN_TIME' | 'FUEL_LEVEL'
  | 'BAROMETRIC' | 'CATALYST_TEMP' | 'RELATIVE_TPS' | 'AMBIENT_TEMP';

export type AlertSeverity = 'critical' | 'warning';

export interface AlertThreshold {
  readonly severity: AlertSeverity;
  readonly condition: 'above' | 'below';
  readonly value: number;
}

export interface PidDefinition {
  readonly id: PidId;
  readonly command: string;
  readonly name: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  // null means this PID is not a standard OBD mode-01 PID (e.g. AT commands)
  readonly expectedResponseBytes: number | null;
  readonly alerts: readonly AlertThreshold[];
}

// Maps a PID id to its full definition
export const PID_DEFINITIONS: Readonly<Record<PidId, PidDefinition>> = {
  RPM: {
    id: 'RPM',
    command: '010C',
    name: 'Engine RPM',
    unit: 'rpm',
    min: 0,
    max: 8000,
    expectedResponseBytes: 2,
    alerts: [
      { severity: 'warning', condition: 'above', value: 6500 },
    ],
  },
  SPEED: {
    id: 'SPEED',
    command: '010D',
    name: 'Vehicle Speed',
    unit: 'km/h',
    min: 0,
    max: 250,
    expectedResponseBytes: 1,
    alerts: [],
  },
  COOLANT_TEMP: {
    id: 'COOLANT_TEMP',
    command: '0105',
    name: 'Coolant Temperature',
    unit: '°C',
    min: -40,
    max: 215,
    expectedResponseBytes: 1,
    alerts: [
      { severity: 'critical', condition: 'above', value: 105 },
      { severity: 'warning', condition: 'above', value: 100 },
    ],
  },
  ENGINE_LOAD: {
    id: 'ENGINE_LOAD',
    command: '0104',
    name: 'Engine Load',
    unit: '%',
    min: 0,
    max: 100,
    expectedResponseBytes: 1,
    alerts: [],
  },
  MAF: {
    id: 'MAF',
    command: '0110',
    name: 'Mass Air Flow',
    unit: 'g/s',
    min: 0,
    max: 655,
    expectedResponseBytes: 2,
    alerts: [],
  },
  TPS: {
    id: 'TPS',
    command: '0111',
    name: 'Throttle Position',
    unit: '%',
    min: 0,
    max: 100,
    expectedResponseBytes: 1,
    alerts: [],
  },
  IAT: {
    id: 'IAT',
    command: '010F',
    name: 'Intake Air Temperature',
    unit: '°C',
    min: -40,
    max: 215,
    expectedResponseBytes: 1,
    alerts: [],
  },
  VOLTAGE: {
    id: 'VOLTAGE',
    command: 'ATRV',
    name: 'Battery Voltage',
    unit: 'V',
    min: 0,
    max: 16,
    // null: AT command, response is a float string like "12.3V", not hex bytes
    expectedResponseBytes: null,
    alerts: [
      { severity: 'critical', condition: 'below', value: 10.5 },
      { severity: 'warning', condition: 'below', value: 11.5 },
    ],
  },
  FUEL_TRIM_SHORT: {
    id: 'FUEL_TRIM_SHORT',
    command: '0106',
    name: 'Short Term Fuel Trim',
    unit: '%',
    min: -100,
    max: 99.2,
    expectedResponseBytes: 1,
    alerts: [
      { severity: 'warning', condition: 'above', value: 25 },
      { severity: 'warning', condition: 'below', value: -25 },
    ],
  },
  FUEL_TRIM_LONG: {
    id: 'FUEL_TRIM_LONG',
    command: '0107',
    name: 'Long Term Fuel Trim',
    unit: '%',
    min: -100,
    max: 99.2,
    expectedResponseBytes: 1,
    alerts: [
      { severity: 'warning', condition: 'above', value: 25 },
      { severity: 'warning', condition: 'below', value: -25 },
    ],
  },
  TIMING_ADVANCE: {
    id: 'TIMING_ADVANCE',
    command: '010E',
    name: 'Timing Advance',
    unit: '°',
    min: -64,
    max: 63.5,
    expectedResponseBytes: 1,
    alerts: [],
  },
  INTAKE_MAP: {
    id: 'INTAKE_MAP',
    command: '010B',
    name: 'Intake Manifold Pressure',
    unit: 'kPa',
    min: 0,
    max: 255,
    expectedResponseBytes: 1,
    alerts: [],
  },
  O2_B1S1: {
    id: 'O2_B1S1',
    command: '0114',
    name: 'O2 Sensor B1S1',
    unit: 'V',
    min: 0,
    max: 1.275,
    expectedResponseBytes: 2,
    alerts: [],
  },
  O2_B1S2: {
    id: 'O2_B1S2',
    command: '0115',
    name: 'O2 Sensor B1S2',
    unit: 'V',
    min: 0,
    max: 1.275,
    expectedResponseBytes: 2,
    alerts: [],
  },
  RUN_TIME: {
    id: 'RUN_TIME',
    command: '011F',
    name: 'Engine Run Time',
    unit: 's',
    min: 0,
    max: 65535,
    expectedResponseBytes: 2,
    alerts: [],
  },
  FUEL_LEVEL: {
    id: 'FUEL_LEVEL',
    command: '012F',
    name: 'Fuel Level',
    unit: '%',
    min: 0,
    max: 100,
    expectedResponseBytes: 1,
    alerts: [
      { severity: 'warning', condition: 'below', value: 10 },
    ],
  },
  BAROMETRIC: {
    id: 'BAROMETRIC',
    command: '0133',
    name: 'Barometric Pressure',
    unit: 'kPa',
    min: 0,
    max: 255,
    expectedResponseBytes: 1,
    alerts: [],
  },
  CATALYST_TEMP: {
    id: 'CATALYST_TEMP',
    command: '013C',
    name: 'Catalyst Temperature',
    unit: '°C',
    min: -40,
    max: 6513.5,
    expectedResponseBytes: 2,
    alerts: [
      { severity: 'warning', condition: 'above', value: 900 },
    ],
  },
  RELATIVE_TPS: {
    id: 'RELATIVE_TPS',
    command: '0145',
    name: 'Relative Throttle Position',
    unit: '%',
    min: 0,
    max: 100,
    expectedResponseBytes: 1,
    alerts: [],
  },
  AMBIENT_TEMP: {
    id: 'AMBIENT_TEMP',
    command: '0146',
    name: 'Ambient Air Temperature',
    unit: '°C',
    min: -40,
    max: 215,
    expectedResponseBytes: 1,
    alerts: [],
  },
} as const;

// Ordered list used for dashboard polling cycle
export const DASHBOARD_PIDS: readonly PidId[] = [
  'RPM',
  'SPEED',
  'COOLANT_TEMP',
  'ENGINE_LOAD',
  'MAF',
  'TPS',
  'IAT',
  'VOLTAGE',
  'FUEL_TRIM_SHORT',
  'FUEL_TRIM_LONG',
  'TIMING_ADVANCE',
  'INTAKE_MAP',
  'O2_B1S1',
  'O2_B1S2',
  'RUN_TIME',
  'FUEL_LEVEL',
  'BAROMETRIC',
  'CATALYST_TEMP',
  'RELATIVE_TPS',
  'AMBIENT_TEMP',
] as const;
