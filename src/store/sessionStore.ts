// Active diagnostic session state.
// The live parameter snapshot lives in obdStore; this store tracks session
// lifecycle, accumulated DTCs, chat messages, and QVAC interpretation status.

import { create } from 'zustand';
import type { DiagnosticSession, SessionStatus } from '@/domain/entities/diagnostic-session';
import { createSession } from '@/domain/entities/diagnostic-session';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { ChatMessage } from '@/domain/entities/chat-message';

export type InterpretationStatus = 'idle' | 'loading' | 'done' | 'error';

interface SessionState {
  activeSession: DiagnosticSession | null;
  interpretationStatus: InterpretationStatus;
  interpretationError: string | null;
  // Mileage entered by the technician before/during the session
  pendingMileage: number | null;

  startSession: (vehicleId: string) => void;
  endSession: (status: Extract<SessionStatus, 'completed' | 'interrupted'>) => void;
  addTroubleCode: (code: TroubleCode) => void;
  clearTroubleCodes: () => void;
  addChatMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setPendingMileage: (km: number | null) => void;
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
  pendingMileage: null,

  startSession: (vehicleId) =>
    set((state) => ({
      activeSession: createSession(vehicleId, state.pendingMileage),
      interpretationStatus: 'idle',
      interpretationError: null,
    })),

  endSession: (status) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, status, endedAt: new Date() }
        : null,
    })),

  addTroubleCode: (code) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, troubleCodes: [...state.activeSession.troubleCodes, code] }
        : null,
    })),

  clearTroubleCodes: () =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, troubleCodes: [] }
        : null,
    })),

  addChatMessage: (message) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, messages: [...state.activeSession.messages, message] }
        : null,
    })),

  clearMessages: () =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, messages: [] }
        : null,
    })),

  setPendingMileage: (km) => set({ pendingMileage: km }),

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
