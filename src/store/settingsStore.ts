// User preferences — persisted across app launches via MMKV.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

const mmkv = createMMKV({ id: 'obdient-settings' });

const mmkvStorage: StateStorage = {
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => { mmkv.remove(name); },
};

export type UnitSystem = 'metric' | 'imperial';

interface SettingsState {
  // Bluetooth address of the last successfully connected ELM327 adapter
  lastDeviceAddress: string | null;
  // OBD polling cycle interval in milliseconds
  pollingIntervalMs: number;
  unitSystem: UnitSystem;
  alertSoundEnabled: boolean;
  alertVibrationEnabled: boolean;
  // Auto-disconnect after this many minutes of RPM=0 (0 = disabled). Protects battery.
  engineOffAutoDisconnectMinutes: number;

  setLastDeviceAddress: (address: string) => void;
  setPollingInterval: (ms: number) => void;
  setUnitSystem: (system: UnitSystem) => void;
  setAlertSoundEnabled: (enabled: boolean) => void;
  setAlertVibrationEnabled: (enabled: boolean) => void;
  setEngineOffAutoDisconnectMinutes: (minutes: number) => void;
  reset: () => void;
}

const DEFAULTS = {
  lastDeviceAddress: null as string | null,
  pollingIntervalMs: 500,
  unitSystem: 'metric' as UnitSystem,
  alertSoundEnabled: true,
  alertVibrationEnabled: true,
  engineOffAutoDisconnectMinutes: 2,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setLastDeviceAddress: (address) => set({ lastDeviceAddress: address }),
      setPollingInterval: (ms) => set({ pollingIntervalMs: ms }),
      setUnitSystem: (system) => set({ unitSystem: system }),
      setAlertSoundEnabled: (enabled) => set({ alertSoundEnabled: enabled }),
      setAlertVibrationEnabled: (enabled) => set({ alertVibrationEnabled: enabled }),
      setEngineOffAutoDisconnectMinutes: (minutes) => set({ engineOffAutoDisconnectMinutes: minutes }),

      reset: () => set(DEFAULTS),
    }),
    {
      name: 'obdient-settings',
      storage: createJSONStorage(() => mmkvStorage),
      // Only persist the data fields, not the action functions
      partialize: (state) => ({
        lastDeviceAddress: state.lastDeviceAddress,
        pollingIntervalMs: state.pollingIntervalMs,
        unitSystem: state.unitSystem,
        alertSoundEnabled: state.alertSoundEnabled,
        alertVibrationEnabled: state.alertVibrationEnabled,
        engineOffAutoDisconnectMinutes: state.engineOffAutoDisconnectMinutes,
      }),
    }
  )
);
