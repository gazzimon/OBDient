// Settings: Bluetooth device pairing/connection, polling interval,
// QVAC on-device model status, and alert preferences. QVAC grouped-card style.

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Switch, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useBluetoothContext } from '@/presentation/providers/BluetoothProvider';
import { useSettingsVM } from '@/presentation/viewmodels/useSettingsVM';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';
import { hypercoreKnowledge } from '@/data/datasources/hypercore-knowledge.datasource';
import { trustRegistry } from '@/data/datasources/trust-registry';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { ConnectionStatus } from '@/presentation/components/feedback/ConnectionStatus';
import { qvacSDK } from '@/data/datasources/qvac-sdk.datasource';
import { qvacRag } from '@/data/datasources/qvac-rag.datasource';
import { claudeKnowledge } from '@/data/datasources/claude-knowledge.datasource';

const MINT = '#2DE1A5';
const MUTED = '#9A9A9A';

// Extracts the most informative message from a QVAC/OBDient load error.
// QvacUnavailableError wraps the real SDK error (with its numeric code) in `.cause`.
function describeLoadError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  const root = e?.cause ?? e;
  const code = root?.code ?? e?.code;
  const msg = root?.message ?? e?.message ?? String(err);
  return code != null ? `[${String(code)}] ${String(msg)}` : String(msg);
}

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
  const isConnected = connectionState === 'connected';

  const claudeApiKey    = useSettingsStore((s) => s.claudeApiKey);
  const setClaudeApiKey = useSettingsStore((s) => s.setClaudeApiKey);
  const [apiKeyInput, setApiKeyInput]     = useState(claudeApiKey ?? '');
  const [showApiKey, setShowApiKey]       = useState(false);
  const [knowledgeCount, setKnowledgeCount] = useState(claudeKnowledge.count());

  // Refresh knowledge count when screen gains focus (entries grow during chat)
  useEffect(() => {
    setKnowledgeCount(claudeKnowledge.count());
  }, [claudeApiKey]);

  const knowledgeNetworkEnabled = useSettingsStore((s) => s.knowledgeNetworkEnabled);
  const setKnowledgeNetworkEnabled = useSettingsStore((s) => s.setKnowledgeNetworkEnabled);
  const contributeKnowledge     = useSettingsStore((s) => s.contributeKnowledge);
  const setContributeKnowledge  = useSettingsStore((s) => s.setContributeKnowledge);

  const [peerCount, setPeerCount]         = useState(0);
  const [trustStats, setTrustStats]       = useState(trustRegistry.stats());

  const [showDevices, setShowDevices] = useState(false);
  const [modelLoaded, setModelLoaded]   = useState(qvacSDK.isLoaded());
  const [modelProgress, setModelProgress] = useState(qvacSDK.getLoadProgress());
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError]     = useState<string | null>(null);

  useEffect(() => {
    setModelLoaded(qvacSDK.isLoaded());
  }, []);

  // Refresh peer count every 5 s while the network is enabled.
  useEffect(() => {
    if (!knowledgeNetworkEnabled) { setPeerCount(0); return; }
    const id = setInterval(() => {
      setPeerCount(hypercoreKnowledge.peerCount());
      setTrustStats(trustRegistry.stats());
    }, 5000);
    setPeerCount(hypercoreKnowledge.peerCount());
    setTrustStats(trustRegistry.stats());
    return () => clearInterval(id);
  }, [knowledgeNetworkEnabled]);

  const handleLoadModel = async () => {
    if (modelLoading || modelLoaded) return;
    setModelError(null);
    setModelLoading(true);

    // Stage 1: chat LLM (required). Honors the custom model URL if set —
    // previously this was silently ignored.
    try {
      const { customModelSrc } = useSettingsStore.getState();
      await qvacSDK.initialize((p) => setModelProgress(p), customModelSrc);
    } catch (err) {
      console.error('[QVAC] LLM model load failed:', err);
      setModelError(`LLM load failed — ${describeLoadError(err)}`);
      setModelLoading(false);
      return;
    }

    // Stage 2: embedding model for RAG (optional — assistant still works without it).
    try {
      await qvacRag.initialize((p) => setModelProgress(p));
    } catch (err) {
      console.error('[QVAC] RAG/embedding model load failed:', err);
      setModelError(`RAG embeddings unavailable — ${describeLoadError(err)}`);
      setModelLoaded(true); // LLM is up; run without retrieval
      setModelLoading(false);
      return;
    }

    setModelLoaded(true);
    setModelLoading(false);
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
              deviceName={null}
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
          <View className="flex-row gap-2 mb-4">
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

          <View className="h-px bg-brand-border mb-4" />

          <Text className="text-brand-muted font-mono text-xs mb-3">
            Auto-disconnect when engine off (protects battery)
          </Text>
          <View className="flex-row gap-2">
            {([0, 1, 2, 5] as const).map((min) => {
              const active = vm.engineOffAutoDisconnectMinutes === min;
              return (
                <Pressable
                  key={min}
                  onPress={() => vm.setEngineOffAutoDisconnectMinutes(min)}
                  className={`flex-1 py-2 rounded-full items-center ${
                    active ? 'bg-brand-pill' : 'border border-brand-border'
                  }`}
                >
                  <Text className={`font-mono text-xs ${active ? 'text-brand-bg' : 'text-brand-muted'}`}>
                    {min === 0 ? 'Off' : `${min}m`}
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
                CARpsy · Qwen3-0.6B · runs offline
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

          {!modelLoaded ? (
            <PillButton
              label={modelLoading ? 'Loading model…' : 'Load model'}
              onPress={handleLoadModel}
              loading={modelLoading}
            />
          ) : (
            <PillButton
              label="Unload & reload"
              onPress={async () => {
                await qvacSDK.dispose();
                setModelLoaded(false);
                setModelProgress(0);
                setModelError(null);
              }}
              variant="destructive"
            />
          )}

          {modelError != null && (
            <Text className="text-brand-red font-mono text-xs mt-3" selectable>
              {modelError}
            </Text>
          )}
        </View>

        {/* ---------- Claude AI ---------- */}
        <SectionHeader title="Claude AI" />

        <View className="bg-brand-surface rounded-2xl p-4 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-1 mr-3">
              <Text className="text-brand-text font-mono text-sm">Anthropic API Key</Text>
              <Text className="text-brand-muted font-mono text-xs mt-0.5">
                Enables cloud fallback for general questions + quality evaluation
              </Text>
            </View>
            <View className={`px-2 py-0.5 rounded-md border ${claudeApiKey ? 'border-brand-teal' : 'border-brand-muted'}`}>
              <Text className={`font-mono text-xs ${claudeApiKey ? 'text-brand-teal' : 'text-brand-muted'}`}>
                {claudeApiKey ? 'CONFIGURED' : 'NOT SET'}
              </Text>
            </View>
          </View>

          {knowledgeCount > 0 && (
            <View className="flex-row items-center justify-between mb-3 px-1">
              <Text className="text-brand-muted font-mono text-xs">
                Knowledge accumulated
              </Text>
              <View className="px-2 py-0.5 rounded-md border border-brand-teal">
                <Text className="text-brand-teal font-mono text-xs">
                  {knowledgeCount} entr{knowledgeCount === 1 ? 'y' : 'ies'}
                </Text>
              </View>
            </View>
          )}

          <View className="flex-row items-center gap-2">
            <TextInput
              className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 text-brand-text font-mono text-xs"
              placeholder="sk-ant-api03-..."
              placeholderTextColor={MUTED}
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              onBlur={() => setClaudeApiKey(apiKeyInput.trim() || null)}
              secureTextEntry={!showApiKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={() => setShowApiKey((v) => !v)}
              className="p-2 active:opacity-60"
            >
              <MaterialCommunityIcons
                name={showApiKey ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={MUTED}
              />
            </Pressable>
          </View>
        </View>

        {/* ---------- Knowledge network ---------- */}
        <SectionHeader title="Knowledge network" />

        <View className="bg-brand-surface rounded-2xl px-4 py-1 mb-4">
          <SettingsRow>
            <View className="flex-1 mr-4">
              <Text className="text-brand-text font-mono text-sm">Distributed RAG</Text>
              <Text className="text-brand-muted font-mono text-xs mt-0.5">
                Share anonymised diagnostic knowledge with peers via P2P
              </Text>
            </View>
            <Switch
              value={knowledgeNetworkEnabled}
              onValueChange={setKnowledgeNetworkEnabled}
              trackColor={{ false: '#2A2A2A', true: MINT }}
              thumbColor="#FFFFFF"
            />
          </SettingsRow>

          {knowledgeNetworkEnabled && (
            <>
              <SettingsRow>
                <View className="flex-1 mr-4">
                  <Text className="text-brand-text font-mono text-sm">Contribute knowledge</Text>
                  <Text className="text-brand-muted font-mono text-xs mt-0.5">
                    Send anonymous DTC patterns to the shared feed (opt-in)
                  </Text>
                </View>
                <Switch
                  value={contributeKnowledge}
                  onValueChange={setContributeKnowledge}
                  trackColor={{ false: '#2A2A2A', true: MINT }}
                  thumbColor="#FFFFFF"
                />
              </SettingsRow>

              <View className="flex-row items-center justify-between py-2">
                <Text className="text-brand-muted font-mono text-xs">Connected peers</Text>
                <View className={`px-2 py-0.5 rounded-md border ${peerCount > 0 ? 'border-brand-teal' : 'border-brand-muted'}`}>
                  <Text className={`font-mono text-xs ${peerCount > 0 ? 'text-brand-teal' : 'text-brand-muted'}`}>
                    {peerCount > 0 ? `${peerCount} peer${peerCount !== 1 ? 's' : ''}` : 'searching…'}
                  </Text>
                </View>
              </View>

              {trustStats.total > 0 && (
                <View className="flex-row gap-2 pb-2">
                  <View className="flex-1 bg-brand-bg rounded-xl px-3 py-2">
                    <Text className="text-brand-muted font-mono text-xs">Known</Text>
                    <Text className="text-brand-text font-mono text-sm mt-0.5">{trustStats.total}</Text>
                  </View>
                  <View className="flex-1 bg-brand-bg rounded-xl px-3 py-2">
                    <Text className="text-brand-muted font-mono text-xs">Trusted</Text>
                    <Text className="text-brand-teal font-mono text-sm mt-0.5">{trustStats.trusted}</Text>
                  </View>
                  {trustStats.silenced > 0 && (
                    <View className="flex-1 bg-brand-bg rounded-xl px-3 py-2">
                      <Text className="text-brand-muted font-mono text-xs">Silenced</Text>
                      <Text className="text-brand-red font-mono text-sm mt-0.5">{trustStats.silenced}</Text>
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </View>

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
