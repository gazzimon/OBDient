// Evaluates a parameter snapshot and new DTCs against defined thresholds,
// then fires TTS + vibration when a condition is met.
// Severity priority: critical → warning → info (DTC).
// Returns on the first untriggered alert so callers can suppress it after actioning.

import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import { PID_DEFINITIONS } from '@/core/constants/pids';
import type { PidId, AlertSeverity } from '@/core/constants/pids';

export interface AlertServices {
  // Platform implementation: expo-speech, react-native Vibration, etc.
  speak: (message: string) => void;
  vibrateLong: () => void;
  vibrateShort: () => void;
}

export interface TriggerAlertInput {
  parameters: ObdParameterSnapshot;
  newTroubleCodes?: readonly TroubleCode[];
  // Keys already alerted this session — prevents repeated TTS for the same condition.
  // Key format: "<PidId>:<severity>" or "DTC:<code>"
  suppressedAlerts?: ReadonlySet<string>;
}

export interface TriggerAlertResult {
  readonly triggered: boolean;
  // Caller should add this key to their suppressedAlerts set after actioning.
  readonly alertKey: string | null;
  readonly severity: AlertSeverity | 'info' | null;
  readonly message: string | null;
}

// Evaluation order: critical thresholds first, then warning, then info DTCs.
const EVAL_ORDER: readonly PidId[] = [
  'COOLANT_TEMP',
  'VOLTAGE',
  'RPM',
  'ENGINE_LOAD',
  'MAF',
  'TPS',
  'IAT',
  'SPEED',
];

export class TriggerAlertUseCase {
  constructor(private readonly services: AlertServices) {}

  execute(input: TriggerAlertInput): TriggerAlertResult {
    const suppressed = input.suppressedAlerts ?? new Set<string>();

    for (const pass of ['critical', 'warning'] as const) {
      for (const pidId of EVAL_ORDER) {
        const param = input.parameters[pidId];
        if (param == null) continue;

        const def = PID_DEFINITIONS[pidId];

        for (const threshold of def.alerts) {
          if (threshold.severity !== pass) continue;

          const breached =
            threshold.condition === 'above'
              ? param.value > threshold.value
              : param.value < threshold.value;

          if (!breached) continue;

          const alertKey = `${pidId}:${pass}`;
          if (suppressed.has(alertKey)) continue;

          const direction = threshold.condition === 'above' ? 'high' : 'low';
          const message =
            pass === 'critical'
              ? `Critical alert: ${def.name} is ${direction} at ${param.value} ${def.unit}`
              : `Warning: ${def.name} is ${direction} at ${param.value} ${def.unit}`;

          this.services.speak(message);

          if (pass === 'critical') {
            this.services.vibrateLong();
          } else {
            this.services.vibrateShort();
          }

          return { triggered: true, alertKey, severity: pass, message };
        }
      }
    }

    // Info pass: new DTC detected
    if (input.newTroubleCodes != null) {
      for (const dtc of input.newTroubleCodes) {
        const alertKey = `DTC:${dtc.code}`;
        if (suppressed.has(alertKey)) continue;

        const message = `New trouble code: ${dtc.code}. ${dtc.description}`;
        this.services.speak(message);

        return { triggered: true, alertKey, severity: 'info', message };
      }
    }

    return { triggered: false, alertKey: null, severity: null, message: null };
  }
}
