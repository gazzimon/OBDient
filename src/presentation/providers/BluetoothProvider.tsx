// Provides Bluetooth device scanning and connection to the component tree.
// Wraps ConnectToVehicleUseCase and wires the result into obdStore + sessionStore.

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
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

export function useBluetoothContext(): BluetoothContextValue {
  const ctx = useContext(BluetoothContext);
  if (ctx == null) throw new Error('useBluetoothContext must be used inside BluetoothProvider');
  return ctx;
}

interface BluetoothProviderProps {
  children: ReactNode;
}

export function BluetoothProvider({ children }: BluetoothProviderProps) {
  const [pairedDevices, setPairedDevices] = useState<readonly BluetoothDevice[]>([]);
  const [isScanning, setIsScanning]       = useState(false);
  const [connectError, setConnectError]   = useState<string | null>(null);

  const setConnecting    = useOBDStore((s) => s.setConnecting);
  const setConnected     = useOBDStore((s) => s.setConnected);
  const setDisconnected  = useOBDStore((s) => s.setDisconnected);
  const startSession     = useSessionStore((s) => s.startSession);
  const endSession       = useSessionStore((s) => s.endSession);
  const setLastDevice    = useSettingsStore((s) => s.setLastDeviceAddress);

  // Ensure DB tables exist before first use
  React.useEffect(() => {
    initializeDatabase().catch((err) =>
      console.error('[BluetoothProvider] DB init error:', err),
    );
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
        startSession(vehicle.id);
      } catch (err) {
        setDisconnected();
        setConnectError(err instanceof Error ? err.message : 'Connection failed');
      }
    },
    [setConnecting, setConnected, setDisconnected, setLastDevice, startSession],
  );

  const disconnect = useCallback(() => {
    // Close the physical BT socket first, then update UI state
    container.obdRepo.disconnect().catch((err) => {
      console.warn('[BluetoothProvider] disconnect error:', err);
    });
    endSession('interrupted');
    setDisconnected();
  }, [endSession, setDisconnected]);

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
