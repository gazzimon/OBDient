// Maps a raw ELM327 hex response to an ObdParameter domain entity.
// Applies the formula, evaluates alert thresholds, and timestamps the reading.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { parsePidResponse } from '@/core/utils/obdParser';
import { ParseError } from '@/core/errors/obd.errors';
import type { ObdParameter, ObdAlert } from '@/domain/entities/obd-parameter';

export function mapRawResponseToObdParameter(
  pidId: PidId,
  rawResponse: string,
): ObdParameter {
  const def = PID_DEFINITIONS[pidId];

  let value: number;
  try {
    value = parsePidResponse(pidId, rawResponse);
  } catch (err) {
    throw new ParseError(rawResponse, err);
  }

  return buildObdParameter(pidId, value);
}

// Builds an ObdParameter from an already-parsed numeric value.
// Used by the real pipeline above and by the mock data generator.
export function buildObdParameter(pidId: PidId, value: number): ObdParameter {
  const def = PID_DEFINITIONS[pidId];

  return {
    pid: pidId,
    name: def.name,
    value,
    unit: def.unit,
    timestamp: new Date(),
    alert: evaluateAlerts(pidId, value),
  };
}

// Checks alert thresholds in priority order (critical before warning)
function evaluateAlerts(pidId: PidId, value: number): ObdAlert | null {
  const def = PID_DEFINITIONS[pidId];

  for (const threshold of def.alerts) {
    const triggered =
      threshold.condition === 'above'
        ? value > threshold.value
        : value < threshold.value;

    if (triggered) {
      return {
        severity: threshold.severity,
        message: buildAlertMessage(def.name, threshold.condition, threshold.value, def.unit),
      };
    }
  }

  return null;
}

function buildAlertMessage(
  name: string,
  condition: 'above' | 'below',
  threshold: number,
  unit: string,
): string {
  return condition === 'above'
    ? `${name} is above ${threshold} ${unit}`
    : `${name} is below ${threshold} ${unit}`;
}
