// Live OBD connection state and real-time parameter snapshot.
// High-frequency gauge animations use Reanimated SharedValues (see ViewModels);
// this store covers everything else that needs to react to parameter changes.

import { create } from 'zustand';
import type { ObdParameter, ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { Vehicle } from '@/domain/entities/vehicle';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface OBDState {
  connectionState: ConnectionState;
  vehicle: Vehicle | null;
  parameters: ObdParameterSnapshot;
  // Alert keys already triggered this connection — prevents repeated TTS for the same condition.
  // Format: "<PidId>:<severity>" or "DTC:<code>"
  suppressedAlerts: ReadonlySet<string>;

  setConnecting: () => void;
  setConnected: (vehicle: Vehicle) => void;
  setDisconnected: () => void;
  updateParameter: (param: ObdParameter) => void;
  clearParameters: () => void;
  suppressAlert: (alertKey: string) => void;
  clearSuppressedAlerts: () => void;
}

export const useOBDStore = create<OBDState>()((set) => ({
  connectionState: 'disconnected',
  vehicle: null,
  parameters: {},
  suppressedAlerts: new Set<string>(),

  setConnecting: () =>
    set({ connectionState: 'connecting', vehicle: null, parameters: {} }),

  setConnected: (vehicle) =>
    set({ connectionState: 'connected', vehicle }),

  setDisconnected: () =>
    set({
      connectionState: 'disconnected',
      vehicle: null,
      parameters: {},
      suppressedAlerts: new Set<string>(),
    }),

  updateParameter: (param) =>
    set((state) => ({
      parameters: { ...state.parameters, [param.pid]: param },
    })),

  clearParameters: () => set({ parameters: {} }),

  suppressAlert: (alertKey) =>
    set((state) => ({
      suppressedAlerts: new Set([...state.suppressedAlerts, alertKey]),
    })),

  clearSuppressedAlerts: () => set({ suppressedAlerts: new Set<string>() }),
}));
