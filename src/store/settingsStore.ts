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
  // Custom GGUF model source: HTTPS URL, local file path, or pear:// key.
  // If null, uses the default SDK bundled model.
  customModelSrc: string | null;
  // Distributed RAG via Hypercore: join the peer network to receive remote knowledge.
  knowledgeNetworkEnabled: boolean;
  // Opt-in to contribute validated diagnostic cases (redacted brief + gated
  // senior answer + outcome) to the harvest seed (PLAN-002 v2 C1). Separate
  // consent from joining the network: cases are gate-checked before they leave.
  contributeCases: boolean;
  // Whether the user has acknowledged the informational-use disclaimer (audit I1).
  // Gates the first-run modal; once true the modal never shows again.
  disclaimerAccepted: boolean;

  setLastDeviceAddress: (address: string) => void;
  setPollingInterval: (ms: number) => void;
  setUnitSystem: (system: UnitSystem) => void;
  setAlertSoundEnabled: (enabled: boolean) => void;
  setAlertVibrationEnabled: (enabled: boolean) => void;
  setEngineOffAutoDisconnectMinutes: (minutes: number) => void;
  setCustomModelSrc: (src: string | null) => void;
  setKnowledgeNetworkEnabled: (enabled: boolean) => void;
  setContributeCases: (enabled: boolean) => void;
  setDisclaimerAccepted: (accepted: boolean) => void;
  reset: () => void;
}

const DEFAULTS = {
  lastDeviceAddress: null as string | null,
  pollingIntervalMs: 500,
  unitSystem: 'metric' as UnitSystem,
  alertSoundEnabled: true,
  alertVibrationEnabled: true,
  engineOffAutoDisconnectMinutes: 2,
  customModelSrc: null as string | null,
  knowledgeNetworkEnabled: false,
  contributeCases: false,
  disclaimerAccepted: false,
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
      setCustomModelSrc: (src) => set({ customModelSrc: src }),
      setKnowledgeNetworkEnabled: (enabled) => set({ knowledgeNetworkEnabled: enabled }),
      setContributeCases: (enabled) => set({ contributeCases: enabled }),
      setDisclaimerAccepted: (accepted) => set({ disclaimerAccepted: accepted }),

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
        customModelSrc: state.customModelSrc,
        knowledgeNetworkEnabled: state.knowledgeNetworkEnabled,
        contributeCases: state.contributeCases,
        disclaimerAccepted: state.disclaimerAccepted,
      }),
    }
  )
);
