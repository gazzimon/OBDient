// Settings: Bluetooth device pairing/connection, polling interval,
// QVAC on-device model status, and alert preferences. QVAC grouped-card style.

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useBluetoothContext } from '@/presentation/providers/BluetoothProvider';
import { useSettingsVM } from '@/presentation/viewmodels/useSettingsVM';
import { useOBDStore } from '@/store/obdStore';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { ConnectionStatus } from '@/presentation/components/feedback/ConnectionStatus';
import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';
import { qvacRag } from '@/data/datasources/qvac-rag.datasource';

const MINT = '#2DE1A5';
const MUTED = '#9A9A9A';

function SettingsRow({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between py-3">
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const {
    pairedDevices,
    isScanning,
    connectError,
    scanPairedDevices,
    connectToDevice,
    disconnect,
  } = useBluetoothContext();

  const vm = useSettingsVM();
  const connectionState = useOBDStore((s) => s.connectionState);
  const vehicle = useOBDStore((s) => s.vehicle);
  const isConnected = connectionState === 'connected';

  const [showDevices, setShowDevices] = useState(false);
  const [modelLoaded, setModelLoaded]   = useState(qvacSDK.isLoaded());
  const [modelProgress, setModelProgress] = useState(qvacSDK.getLoadProgress());
  const [modelLoading, setModelLoading] = useState(false);

  useEffect(() => {
    setModelLoaded(qvacSDK.isLoaded());
  }, []);

  const handleLoadModel = () => {
    if (modelLoading || modelLoaded) return;
    setModelLoading(true);
    qvacSDK
      .initialize((p) => setModelProgress(p))
      .then(() => qvacRag.initialize((p) => setModelProgress(p)))
      .then(() => { setModelLoaded(true); setModelLoading(false); })
      .catch(() => { setModelLoading(false); });
  };

  const handleScan = () => {
    setShowDevices(true);
    void scanPairedDevices();
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------- Vehicle connection ---------- */}
        <SectionHeader title="Vehicle Connection" />

        <View className="bg-brand-surface rounded-2xl p-4 mb-6">
          <SettingsRow>
            <ConnectionStatus
              state={connectionState}
              deviceName={vehicle != null ? `${vehicle.make} · ${vehicle.protocol}` : null}
            />
          </SettingsRow>

          {isConnected ? (
            <PillButton label="Disconnect" onPress={disconnect} variant="destructive" />
          ) : (
            <PillButton
              label={isScanning ? 'Scanning…' : 'Scan Paired Devices'}
              onPress={handleScan}
              loading={isScanning}
            />
          )}

          {connectError != null && (
            <Text className="text-brand-red font-mono text-xs mt-3">{connectError}</Text>
          )}

          {showDevices && !isConnected && pairedDevices.length === 0 && !isScanning && (
            <Text className="text-brand-muted font-mono text-xs mt-3 text-center">
              No paired devices found. Pair your ELM327 in Android Bluetooth settings first (PIN 1234).
            </Text>
          )}

          {showDevices && !isConnected &&
            pairedDevices.map((device) => (
              <Pressable
                key={device.address}
                onPress={() => void connectToDevice(device)}
                className="flex-row items-center justify-between py-3 border-t border-brand-border active:opacity-60"
              >
                <View className="flex-row items-center gap-3">
                  <MaterialCommunityIcons name="bluetooth" size={16} color={MINT} />
                  <View>
                    <Text className="text-brand-text font-mono text-sm">{device.name}</Text>
                    <Text className="text-brand-muted font-mono text-xs">{device.address}</Text>
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={MUTED} />
              </Pressable>
            ))}
        </View>

        {/* ---------- Alerts ---------- */}
        <SectionHeader title="Alerts" />

        <View className="bg-brand-surface rounded-2xl px-4 py-1 mb-6">
          <SettingsRow>
            <Text className="text-brand-text font-mono text-sm">Voice alerts</Text>
            <Switch
              value={vm.alertSoundEnabled}
              onValueChange={vm.setAlertSoundEnabled}
              trackColor={{ true: MINT, false: '#3A3A3C' }}
              thumbColor="#F5F5F5"
            />
          </SettingsRow>
          <View className="h-px bg-brand-border" />
          <SettingsRow>
            <Text className="text-brand-text font-mono text-sm">Vibration</Text>
            <Switch
              value={vm.alertVibrationEnabled}
              onValueChange={vm.setAlertVibrationEnabled}
              trackColor={{ true: MINT, false: '#3A3A3C' }}
              thumbColor="#F5F5F5"
            />
          </SettingsRow>
        </View>

        {/* ---------- Polling ---------- */}
        <SectionHeader title="Polling" />

        <View className="bg-brand-surface rounded-2xl p-4 mb-6">
          <Text className="text-brand-muted font-mono text-xs mb-3">
            Refresh interval
          </Text>
          <View className="flex-row gap-2">
            {[250, 500, 1000].map((ms) => {
              const active = vm.pollingIntervalMs === ms;
              return (
                <Pressable
                  key={ms}
                  onPress={() => vm.setPollingInterval(ms)}
                  className={`flex-1 py-2 rounded-full items-center ${
                    active ? 'bg-brand-pill' : 'border border-brand-border'
                  }`}
                >
                  <Text className={`font-mono text-xs ${active ? 'text-brand-bg' : 'text-brand-muted'}`}>
                    {ms} ms
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ---------- QVAC on-device model ---------- */}
        <SectionHeader title="QVAC Assistant" />

        <View className="bg-brand-surface rounded-2xl p-4 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-brand-text font-mono text-sm">On-device model</Text>
              <Text className="text-brand-muted font-mono text-xs mt-0.5">
                Llama 3.2 + on-device RAG · runs offline
              </Text>
            </View>
            <View className={`px-2 py-0.5 rounded-md border ${modelLoaded ? 'border-brand-teal' : 'border-brand-muted'}`}>
              <Text className={`font-mono text-xs ${modelLoaded ? 'text-brand-teal' : 'text-brand-muted'}`}>
                {modelLoaded ? 'READY' : 'NOT LOADED'}
              </Text>
            </View>
          </View>

          {modelLoading && (
            <View className="mb-3">
              <View className="h-1.5 bg-brand-border rounded-full overflow-hidden">
                <View
                  className="h-full bg-brand-teal rounded-full"
                  style={{ width: `${Math.round(modelProgress * 100)}%` }}
                />
              </View>
              <Text className="text-brand-muted font-mono text-xs mt-1 text-right">
                {Math.round(modelProgress * 100)}%
              </Text>
            </View>
          )}

          {!modelLoaded && (
            <PillButton
              label={modelLoading ? 'Loading model…' : 'Load model'}
              onPress={handleLoadModel}
              loading={modelLoading}
            />
          )}
        </View>

        {/* ---------- Connected Vehicle ---------- */}
        {isConnected && vehicle != null && (
          <>
            <SectionHeader title="Connected Vehicle" />
            <View className="bg-brand-surface rounded-2xl px-4 py-1 mb-6">
              {vehicle.make !== 'Unknown' && (
                <SettingsRow>
                  <Text className="text-brand-muted font-mono text-xs">Make</Text>
                  <Text className="text-brand-text font-mono text-sm">{vehicle.make}</Text>
                </SettingsRow>
              )}
              {vehicle.model !== 'Unknown' && (
                <>
                  <View className="h-px bg-brand-border" />
                  <SettingsRow>
                    <Text className="text-brand-muted font-mono text-xs">Model</Text>
                    <Text className="text-brand-text font-mono text-sm">{vehicle.model}</Text>
                  </SettingsRow>
                </>
              )}
              {vehicle.year != null && (
                <>
                  <View className="h-px bg-brand-border" />
                  <SettingsRow>
                    <Text className="text-brand-muted font-mono text-xs">Year</Text>
                    <Text className="text-brand-text font-mono text-sm">{vehicle.year}</Text>
                  </SettingsRow>
                </>
              )}
              {vehicle.manufacturer != null && (
                <>
                  <View className="h-px bg-brand-border" />
                  <SettingsRow>
                    <Text className="text-brand-muted font-mono text-xs">Manufacturer</Text>
                    <Text className="text-brand-text font-mono text-sm" numberOfLines={1}>{vehicle.manufacturer}</Text>
                  </SettingsRow>
                </>
              )}
              {vehicle.plantCountry != null && (
                <>
                  <View className="h-px bg-brand-border" />
                  <SettingsRow>
                    <Text className="text-brand-muted font-mono text-xs">Plant</Text>
                    <Text className="text-brand-text font-mono text-sm">{vehicle.plantCountry}</Text>
                  </SettingsRow>
                </>
              )}
              {vehicle.protocol !== 'UNKNOWN' && (
                <>
                  <View className="h-px bg-brand-border" />
                  <SettingsRow>
                    <Text className="text-brand-muted font-mono text-xs">Protocol</Text>
                    <Text className="text-brand-teal font-mono text-xs">{vehicle.protocol}</Text>
                  </SettingsRow>
                </>
              )}
              {vehicle.vin != null && (
                <>
                  <View className="h-px bg-brand-border" />
                  <SettingsRow>
                    <Text className="text-brand-muted font-mono text-xs">VIN</Text>
                    <Text className="text-brand-teal font-mono text-xs tracking-widest">{vehicle.vin}</Text>
                  </SettingsRow>
                </>
              )}
            </View>
          </>
        )}

        {/* ---------- About ---------- */}
        <SectionHeader title="About" />

        <View className="bg-brand-surface rounded-2xl px-4 py-1">
          <SettingsRow>
            <Text className="text-brand-text font-mono text-sm">App version</Text>
            <Text className="text-brand-teal font-mono text-sm">v0.1.7 (VIN UI)</Text>
          </SettingsRow>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
