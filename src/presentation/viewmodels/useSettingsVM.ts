// Thin wrapper over settingsStore — provides typed handlers for the settings screen.

import { useSettingsStore } from '@/store/settingsStore';
import type { UnitSystem } from '@/store/settingsStore';

export function useSettingsVM() {
  const store = useSettingsStore();

  return {
    lastDeviceAddress:     store.lastDeviceAddress,
    pollingIntervalMs:     store.pollingIntervalMs,
    unitSystem:            store.unitSystem,
    alertSoundEnabled:     store.alertSoundEnabled,
    alertVibrationEnabled: store.alertVibrationEnabled,

    setLastDeviceAddress:     store.setLastDeviceAddress,
    setPollingInterval:       store.setPollingInterval,
    setUnitSystem:            (system: UnitSystem) => store.setUnitSystem(system),
    setAlertSoundEnabled:     store.setAlertSoundEnabled,
    setAlertVibrationEnabled: store.setAlertVibrationEnabled,
    reset:                    store.reset,
  } as const;
}
