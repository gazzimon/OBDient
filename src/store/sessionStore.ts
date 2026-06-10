// Active diagnostic session state.
// The live parameter snapshot lives in obdStore; this store tracks session
// lifecycle, accumulated DTCs, and QVAC interpretation status.

import { create } from 'zustand';
import type { DiagnosticSession, SessionStatus } from '@/domain/entities/diagnostic-session';
import { createSession } from '@/domain/entities/diagnostic-session';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';

export type InterpretationStatus = 'idle' | 'loading' | 'done' | 'error';

interface SessionState {
  activeSession: DiagnosticSession | null;
  interpretationStatus: InterpretationStatus;
  interpretationError: string | null;

  startSession: (vehicleId: string) => void;
  endSession: (status: Extract<SessionStatus, 'completed' | 'interrupted'>) => void;
  addTroubleCode: (code: TroubleCode) => void;
  clearTroubleCodes: () => void;
  // Called when the final parameter snapshot is ready (just before saving)
  snapshotParameters: (params: ObdParameterSnapshot) => void;
  setInterpretation: (text: string) => void;
  setInterpretationLoading: () => void;
  setInterpretationError: (error: string) => void;
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  activeSession: null,
  interpretationStatus: 'idle',
  interpretationError: null,

  startSession: (vehicleId) =>
    set({
      activeSession: createSession(vehicleId),
      interpretationStatus: 'idle',
      interpretationError: null,
    }),

  endSession: (status) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, status, endedAt: new Date() }
        : null,
    })),

  addTroubleCode: (code) =>
    set((state) => ({
      activeSession: state.activeSession
        ? {
            ...state.activeSession,
            troubleCodes: [...state.activeSession.troubleCodes, code],
          }
        : null,
    })),

  clearTroubleCodes: () =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, troubleCodes: [] }
        : null,
    })),

  snapshotParameters: (params) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, parameters: params }
        : null,
    })),

  setInterpretation: (text) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, interpretation: text }
        : null,
      interpretationStatus: 'done',
      interpretationError: null,
    })),

  setInterpretationLoading: () =>
    set({ interpretationStatus: 'loading', interpretationError: null }),

  setInterpretationError: (error) =>
    set({ interpretationStatus: 'error', interpretationError: error }),

  resetSession: () =>
    set({
      activeSession: null,
      interpretationStatus: 'idle',
      interpretationError: null,
    }),
}));
