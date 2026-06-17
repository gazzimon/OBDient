// Reads and clears DTCs. Populates sessionStore with detected codes.

import { useState, useCallback } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { container } from '@/data/container';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export type DTCLoadState = 'idle' | 'loading' | 'done' | 'error';

export function useDiagnosticsVM() {
  const [loadState, setLoadState]   = useState<DTCLoadState>('idle');
  const [errorMessage, setError]    = useState<string | null>(null);
  const [lastReadAt, setLastReadAt] = useState<Date | null>(null);

  const addTroubleCode   = useSessionStore((s) => s.addTroubleCode);
  const clearTroubleCodes = useSessionStore((s) => s.clearTroubleCodes);
  const activeSession    = useSessionStore((s) => s.activeSession);

  const codes: readonly TroubleCode[] = activeSession?.troubleCodes ?? [];

  const readCodes = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    try {
      const result = await container.readTroubleCodes.execute();
      clearTroubleCodes();
      result.codes.forEach(addTroubleCode);
      setLastReadAt(result.readAt);
      setLoadState('done');
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read DTCs');
      setLoadState('error');
      return null;
    }
  }, [addTroubleCode, clearTroubleCodes]);

  const clearCodes = useCallback(async () => {
    try {
      await container.clearTroubleCodes.execute(true);
      clearTroubleCodes();
      setLoadState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear DTCs');
      setLoadState('error');
    }
  }, [clearTroubleCodes]);

  return {
    codes,
    loadState,
    errorMessage,
    lastReadAt,
    hasCritical: codes.some((c) => c.severity === 'critical'),
    hasWarning:  codes.some((c) => c.severity === 'warning'),
    readCodes,
    clearCodes,
  } as const;
}
