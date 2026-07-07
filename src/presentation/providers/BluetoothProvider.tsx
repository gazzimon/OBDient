// Provides Bluetooth device scanning and connection to the component tree.
// Wraps ConnectToVehicleUseCase and wires the result into obdStore + sessionStore.

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { container } from '@/data/container';
import { initializeDatabase } from '@/data/datasources/storage.datasource';

// RNBluetoothClassic types
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import type { BluetoothDevice } from 'react-native-bluetooth-classic';

interface BluetoothContextValue {
  pairedDevices: readonly BluetoothDevice[];
  isScanning: boolean;
  connectError: string | null;
  scanPairedDevices: () => Promise<void>;
  connectToDevice: (device: BluetoothDevice) => Promise<void>;
  disconnect: () => void;
}

const BluetoothContext = createContext<BluetoothContextValue | null>(null);

// Android 12+ (API 31) requires BLUETOOTH_CONNECT/SCAN as runtime permissions.
// Older versions only need the manifest entries (plus location on 10-11).
async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }

  // Android 10-11: Bluetooth Classic discovery needs fine location
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// Persists the current active session to SQLite. Fire-and-forget — never throws.
async function persistSession(reason: string): Promise<void> {
  const session = useSessionStore.getState().activeSession;
  const parameters = useOBDStore.getState().parameters;
  if (!session) return;
  try {
    await container.saveDiagnosticReport.execute({
      session,
      finalParameters: parameters,
    });
    console.log(`[BluetoothProvider] Session persisted (${reason})`);
  } catch (err) {
    console.error(`[BluetoothProvider] Failed to persist session (${reason}):`, err);
  }
}

export function useBluetoothContext(): BluetoothContextValue {
  const ctx = useContext(BluetoothContext);
  if (ctx == null) throw new Error('useBluetoothContext must be used inside BluetoothProvider');
  return ctx;
}

interface BluetoothProviderProps {
  children: ReactNode;
}

// Auto-save active session every 30 seconds to protect against crashes/force-close.
const AUTO_SAVE_INTERVAL_MS = 30_000;

export function BluetoothProvider({ children }: BluetoothProviderProps) {
  const [pairedDevices, setPairedDevices] = useState<readonly BluetoothDevice[]>([]);
  const [isScanning, setIsScanning]       = useState(false);
  const [connectError, setConnectError]   = useState<string | null>(null);

  const setConnecting    = useOBDStore((s) => s.setConnecting);
  const setConnected     = useOBDStore((s) => s.setConnected);
  const setDisconnected  = useOBDStore((s) => s.setDisconnected);
  const adoptVehicle     = useSessionStore((s) => s.adoptVehicle);
  const endSession       = useSessionStore((s) => s.endSession);
  const setLastDevice    = useSettingsStore((s) => s.setLastDeviceAddress);

  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAutoSave = useCallback(() => {
    if (autoSaveTimer.current !== null) {
      clearInterval(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
  }, []);

  const startAutoSave = useCallback(() => {
    stopAutoSave();
    autoSaveTimer.current = setInterval(() => {
      void persistSession('auto-save');
    }, AUTO_SAVE_INTERVAL_MS);
  }, [stopAutoSave]);

  // Ensure DB tables exist before first use
  useEffect(() => {
    initializeDatabase().catch((err) =>
      console.error('[BluetoothProvider] DB init error:', err),
    );
  }, []);

  // Save session when the app goes to background (user switches apps, locks screen, etc.)
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        void persistSession('app-background');
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  const scanPairedDevices = useCallback(async () => {
    setIsScanning(true);
    setConnectError(null);
    try {
      const granted = await requestBluetoothPermissions();
      if (!granted) {
        setConnectError('Bluetooth permission denied. Enable it in Android app settings.');
        return;
      }
      const devices = await RNBluetoothClassic.getBondedDevices();
      setPairedDevices(devices);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to list paired devices');
    } finally {
      setIsScanning(false);
    }
  }, []);

  const connectToDevice = useCallback(
    async (device: BluetoothDevice) => {
      setConnectError(null);
      setConnecting();
      try {
        const { vehicle } = await container.connectToVehicle.execute({
          deviceAddress: device.address,
        });
        setConnected(vehicle);
        setLastDevice(device.address);
        // Adopt (not replace): an always-open chat may already hold an intake
        // conversation started before the adapter was connected (ADR-0009).
        adoptVehicle(vehicle.id);
        startAutoSave();
      } catch (err) {
        setDisconnected();
        setConnectError(err instanceof Error ? err.message : 'Connection failed');
      }
    },
    [setConnecting, setConnected, setDisconnected, setLastDevice, adoptVehicle, startAutoSave],
  );

  const disconnect = useCallback(() => {
    stopAutoSave();

    // Snapshot parameters into the session before ending it
    const parameters = useOBDStore.getState().parameters;
    useSessionStore.getState().snapshotParameters(parameters);
    endSession('interrupted');

    // Persist to SQLite before closing the BT socket
    void persistSession('disconnect');

    // Close the physical BT socket
    container.obdRepo.disconnect().catch((err) => {
      console.warn('[BluetoothProvider] disconnect error:', err);
    });
    setDisconnected();
  }, [endSession, setDisconnected, stopAutoSave]);

  // Clean up timer if component unmounts while connected
  useEffect(() => {
    return () => stopAutoSave();
  }, [stopAutoSave]);

  return (
    <BluetoothContext.Provider
      value={{
        pairedDevices,
        isScanning,
        connectError,
        scanPairedDevices,
        connectToDevice,
        disconnect,
      }}
    >
      {children}
    </BluetoothContext.Provider>
  );
}
