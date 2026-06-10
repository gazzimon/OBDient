// Wires real-time OBD polling to the obdStore and fires TriggerAlertUseCase
// on every parameter update. Stops polling on unmount or disconnection.

import { useEffect, useRef, useCallback } from 'react';
import { Vibration } from 'react-native';
import * as Speech from 'expo-speech';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';
import { container } from '@/data/container';
import { TriggerAlertUseCase } from '@/domain/usecases/trigger-alert';
import type { AlertServices } from '@/domain/usecases/trigger-alert';

function buildAlertServices(
  soundEnabled: boolean,
  vibrationEnabled: boolean,
): AlertServices {
  return {
    speak: (msg) => {
      if (soundEnabled) Speech.speak(msg, { language: 'en-US', rate: 1.1 });
    },
    vibrateLong: () => {
      if (vibrationEnabled) Vibration.vibrate([0, 600]);
    },
    vibrateShort: () => {
      if (vibrationEnabled) Vibration.vibrate([0, 250]);
    },
  };
}

export function useDashboardVM() {
  const connectionState = useOBDStore((s) => s.connectionState);
  const vehicle        = useOBDStore((s) => s.vehicle);
  const parameters     = useOBDStore((s) => s.parameters);
  const updateParameter = useOBDStore((s) => s.updateParameter);
  const setDisconnected = useOBDStore((s) => s.setDisconnected);
  const suppressAlert   = useOBDStore((s) => s.suppressAlert);

  const pollingIntervalMs  = useSettingsStore((s) => s.pollingIntervalMs);
  const alertSoundEnabled  = useSettingsStore((s) => s.alertSoundEnabled);
  const alertVibEnabled    = useSettingsStore((s) => s.alertVibrationEnabled);

  // Stable ref so the onParameter callback always sees current alert settings
  const alertUCRef = useRef<TriggerAlertUseCase | null>(null);

  useEffect(() => {
    alertUCRef.current = new TriggerAlertUseCase(
      buildAlertServices(alertSoundEnabled, alertVibEnabled),
    );
  }, [alertSoundEnabled, alertVibEnabled]);

  const onParameter = useCallback(
    (param: Parameters<typeof updateParameter>[0]) => {
      updateParameter(param);

      const uc = alertUCRef.current;
      if (uc == null) return;

      const { parameters: snap, suppressedAlerts } = useOBDStore.getState();
      const result = uc.execute({ parameters: snap, suppressedAlerts });
      if (result.triggered && result.alertKey != null) {
        suppressAlert(result.alertKey);
      }
    },
    [updateParameter, suppressAlert],
  );

  useEffect(() => {
    if (connectionState !== 'connected') return;

    container.readRealTimeParameters.start({
      intervalMs: pollingIntervalMs,
      onParameter,
      onError: (err) => console.warn('[Dashboard] PID error:', err),
      onConnectionLost: setDisconnected,
    });

    return () => container.readRealTimeParameters.stop();
  }, [connectionState, pollingIntervalMs, onParameter, setDisconnected]);

  return {
    connectionState,
    vehicle,
    parameters,
    isConnected: connectionState === 'connected',
  } as const;
}
