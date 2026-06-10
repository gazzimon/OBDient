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
  qvacBaseUrl: string;
  qvacModel: string;
  unitSystem: UnitSystem;
  alertSoundEnabled: boolean;
  alertVibrationEnabled: boolean;

  setLastDeviceAddress: (address: string) => void;
  setPollingInterval: (ms: number) => void;
  setQvacBaseUrl: (url: string) => void;
  setQvacModel: (model: string) => void;
  setUnitSystem: (system: UnitSystem) => void;
  setAlertSoundEnabled: (enabled: boolean) => void;
  setAlertVibrationEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const DEFAULTS = {
  lastDeviceAddress: null as string | null,
  pollingIntervalMs: 500,
  qvacBaseUrl: process.env['EXPO_PUBLIC_QVAC_BASE_URL'] ?? 'http://localhost:11434/v1',
  qvacModel: process.env['EXPO_PUBLIC_QVAC_MODEL'] ?? 'qwen2.5:7b',
  unitSystem: 'metric' as UnitSystem,
  alertSoundEnabled: true,
  alertVibrationEnabled: true,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setLastDeviceAddress: (address) => set({ lastDeviceAddress: address }),
      setPollingInterval: (ms) => set({ pollingIntervalMs: ms }),
      setQvacBaseUrl: (url) => set({ qvacBaseUrl: url }),
      setQvacModel: (model) => set({ qvacModel: model }),
      setUnitSystem: (system) => set({ unitSystem: system }),
      setAlertSoundEnabled: (enabled) => set({ alertSoundEnabled: enabled }),
      setAlertVibrationEnabled: (enabled) => set({ alertVibrationEnabled: enabled }),

      reset: () => set(DEFAULTS),
    }),
    {
      name: 'obdient-settings',
      storage: createJSONStorage(() => mmkvStorage),
      // Only persist the data fields, not the action functions
      partialize: (state) => ({
        lastDeviceAddress: state.lastDeviceAddress,
        pollingIntervalMs: state.pollingIntervalMs,
        qvacBaseUrl: state.qvacBaseUrl,
        qvacModel: state.qvacModel,
        unitSystem: state.unitSystem,
        alertSoundEnabled: state.alertSoundEnabled,
        alertVibrationEnabled: state.alertVibrationEnabled,
      }),
    }
  )
);
