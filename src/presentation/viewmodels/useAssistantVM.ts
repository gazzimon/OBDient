// Sends the current diagnostic snapshot to QVAC and manages interpretation state.

import { useCallback } from 'react';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { container } from '@/data/container';

export function useAssistantVM() {
  const parameters        = useOBDStore((s) => s.parameters);
  const vehicle           = useOBDStore((s) => s.vehicle);
  const activeSession     = useSessionStore((s) => s.activeSession);
  const setLoading        = useSessionStore((s) => s.setInterpretationLoading);
  const setInterpretation = useSessionStore((s) => s.setInterpretation);
  const setError          = useSessionStore((s) => s.setInterpretationError);
  const interpretationStatus = useSessionStore((s) => s.interpretationStatus);
  const interpretationError  = useSessionStore((s) => s.interpretationError);

  const codes = activeSession?.troubleCodes ?? [];
  const interpretation = activeSession?.interpretation ?? null;

  const interpret = useCallback(async () => {
    setLoading();
    try {
      const vehicleContext =
        vehicle != null ? `${vehicle.make} ${vehicle.model} (${vehicle.protocol})` : undefined;

      const result = await container.interpretWithQVAC.execute({
        parameters,
        troubleCodes: codes,
        ...(vehicleContext !== undefined && { vehicleContext }),
      });
      setInterpretation(result.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Interpretation failed');
    }
  }, [parameters, codes, vehicle, setLoading, setInterpretation, setError]);

  return {
    interpretation,
    interpretationStatus,
    interpretationError,
    isLoading: interpretationStatus === 'loading',
    interpret,
  } as const;
}
