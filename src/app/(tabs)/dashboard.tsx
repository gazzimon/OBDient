// Main dashboard: live gauges + metric grid.
// Uses real OBD data when connected; falls back to mock data (DEMO badge)
// so the UI can be validated on the emulator without an ELM327 adapter.

import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDashboardVM } from '@/presentation/viewmodels/useDashboardVM';
import { useMockParameters } from '@/presentation/hooks/useMockParameters';
import { RPMGauge } from '@/presentation/components/gauges/RPMGauge';
import { SpeedGauge } from '@/presentation/components/gauges/SpeedGauge';
import { TempGauge } from '@/presentation/components/gauges/TempGauge';
import { VoltageGauge } from '@/presentation/components/gauges/VoltageGauge';
import { MetricCard } from '@/presentation/components/dashboard/MetricCard';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { ConnectionStatus } from '@/presentation/components/feedback/ConnectionStatus';
import { AlertBanner } from '@/presentation/components/feedback/AlertBanner';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';

// Finds the highest-priority active alert in the snapshot
function findActiveAlert(params: ObdParameterSnapshot) {
  let warning: { key: string; message: string } | null = null;
  for (const param of Object.values(params)) {
    if (param.alert == null) continue;
    const entry = { key: `${param.pid}:${param.alert.severity}`, message: param.alert.message };
    if (param.alert.severity === 'critical') return { ...entry, severity: 'critical' as const };
    warning = entry;
  }
  return warning != null ? { ...warning, severity: 'warning' as const } : null;
}

export default function DashboardScreen() {
  const { connectionState, vehicle, parameters: liveParams, isConnected } = useDashboardVM();
  const mockParams = useMockParameters();
  const [dismissedAlertKey, setDismissedAlertKey] = useState<string | null>(null);

  const params = isConnected ? liveParams : mockParams;
  const activeAlert = findActiveAlert(params);
  const showBanner = activeAlert != null && activeAlert.key !== dismissedAlertKey;

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      {/* Top bar */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <ConnectionStatus state={connectionState} deviceName={vehicle?.make ?? null} />
        {!isConnected && (
          <View className="px-2 py-0.5 rounded-md border border-brand-muted">
            <Text className="text-brand-muted font-mono text-xs">DEMO</Text>
          </View>
        )}
      </View>

      {showBanner && (
        <AlertBanner
          severity={activeAlert.severity}
          message={activeAlert.message}
          onDismiss={() => setDismissedAlertKey(activeAlert.key)}
        />
      )}

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Live Monitor" />

        {/* Primary gauges — 2×2 grid */}
        <View className="flex-row justify-between mb-2">
          <RPMGauge param={params.RPM} />
          <SpeedGauge param={params.SPEED} />
        </View>
        <View className="flex-row justify-between mb-6">
          <TempGauge param={params.COOLANT_TEMP} />
          <VoltageGauge param={params.VOLTAGE} />
        </View>

        <SectionHeader title="Engine Data" />

        {/* Secondary metrics — QVAC card grid */}
        <View className="flex-row gap-3 mb-3">
          <MetricCard icon="engine-outline" label="Engine Load" param={params.ENGINE_LOAD} />
          <MetricCard icon="weather-windy" label="MAF" param={params.MAF} />
        </View>
        <View className="flex-row gap-3">
          <MetricCard icon="speedometer-slow" label="Throttle" param={params.TPS} />
          <MetricCard icon="thermometer-low" label="Intake Air" param={params.IAT} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
