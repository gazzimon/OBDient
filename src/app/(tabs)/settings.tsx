// Settings: Bluetooth device pairing/connection, polling interval,
// QVAC server config, and alert preferences. QVAC grouped-card style.

import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useBluetoothContext } from '@/presentation/providers/BluetoothProvider';
import { useSettingsVM } from '@/presentation/viewmodels/useSettingsVM';
import { useOBDStore } from '@/store/obdStore';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { ConnectionStatus } from '@/presentation/components/feedback/ConnectionStatus';

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

        {/* ---------- QVAC server ---------- */}
        <SectionHeader title="QVAC Assistant" />

        <View className="bg-brand-surface rounded-2xl p-4 mb-6">
          <Text className="text-brand-muted font-mono text-xs mb-2">Server URL</Text>
          <TextInput
            value={vm.qvacBaseUrl}
            onChangeText={vm.setQvacBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="border border-brand-teal rounded-xl px-3 py-2 text-brand-text font-mono text-sm mb-4"
            placeholderTextColor={MUTED}
          />
          <Text className="text-brand-muted font-mono text-xs mb-2">Model</Text>
          <TextInput
            value={vm.qvacModel}
            onChangeText={vm.setQvacModel}
            autoCapitalize="none"
            autoCorrect={false}
            className="border border-brand-teal rounded-xl px-3 py-2 text-brand-text font-mono text-sm"
            placeholderTextColor={MUTED}
          />
        </View>

        {/* ---------- About ---------- */}
        <SectionHeader title="About" />

        <View className="bg-brand-surface rounded-2xl px-4 py-1">
          <SettingsRow>
            <Text className="text-brand-text font-mono text-sm">App version</Text>
            <Text className="text-brand-teal font-mono text-sm">v0.1.0 (MVP)</Text>
          </SettingsRow>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
