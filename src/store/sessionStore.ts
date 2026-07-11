// Active diagnostic session state.
// The live parameter snapshot lives in obdStore; this store tracks session
// lifecycle, accumulated DTCs, and chat messages.

import { create } from 'zustand';
import type { DiagnosticSession, SessionStatus } from '@/domain/entities/diagnostic-session';
import { createSession } from '@/domain/entities/diagnostic-session';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { ChatMessage } from '@/domain/entities/chat-message';

interface SessionState {
  activeSession: DiagnosticSession | null;
  // Mileage entered by the technician before/during the session
  pendingMileage: number | null;

  startSession: (vehicleId: string) => void;
  // Reopen a saved session as the active one (Reports → "Continue"), so the
  // owner can keep chatting with the full history as context.
  resumeSession: (session: DiagnosticSession) => void;
  // Attaches a just-connected vehicle to the ongoing (ad-hoc) session instead
  // of replacing it — the pre-connection chat/intake must survive the connect.
  adoptVehicle: (vehicleId: string) => void;
  setSessionMileage: (km: number | null) => void;
  endSession: (status: Extract<SessionStatus, 'completed' | 'interrupted'>) => void;
  addTroubleCode: (code: TroubleCode) => void;
  clearTroubleCodes: () => void;
  addChatMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setPendingMileage: (km: number | null) => void;
  snapshotParameters: (params: ObdParameterSnapshot) => void;
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  activeSession: null,
  pendingMileage: null,

  startSession: (vehicleId) =>
    set((state) => ({
      activeSession: createSession(vehicleId, state.pendingMileage),
    })),

  resumeSession: (session) =>
    set({ activeSession: session, pendingMileage: session.mileage ?? null }),

  adoptVehicle: (vehicleId) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, vehicleId }
        : createSession(vehicleId, state.pendingMileage),
    })),

  setSessionMileage: (km) =>
    set((state) => ({
      pendingMileage: km,
      activeSession: state.activeSession
        ? { ...state.activeSession, mileage: km }
        : null,
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

  resetSession: () => set({ activeSession: null }),
}));
