// Diagnostics: read DTCs from the ECU, clear them (with confirmation),
// and request an AI interpretation of the current state via QVAC.

import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDiagnosticsVM } from '@/presentation/viewmodels/useDiagnosticsVM';
import { useAssistantVM } from '@/presentation/viewmodels/useAssistantVM';
import { useOBDStore } from '@/store/obdStore';
import { TroubleCodeCard } from '@/presentation/components/diagnostics/TroubleCodeCard';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';

export default function DiagnosticsScreen() {
  const connectionState = useOBDStore((s) => s.connectionState);
  const isConnected = connectionState === 'connected';

  const { codes, loadState, errorMessage, lastReadAt, readCodes, clearCodes } =
    useDiagnosticsVM();
  const { interpretation, isLoading: aiLoading, interpretationError, interpret } =
    useAssistantVM();

  const confirmClear = () => {
    Alert.alert(
      'Clear trouble codes',
      'This erases all stored DTCs from the ECU and turns off the check engine light. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear codes', style: 'destructive', onPress: () => void clearCodes() },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Trouble Codes" />

        {!isConnected && (
          <View className="bg-brand-surface rounded-2xl p-4 mb-4">
            <Text className="text-brand-muted font-mono text-sm text-center leading-5">
              Connect to a vehicle in Settings to read trouble codes.
            </Text>
          </View>
        )}

        <PillButton
          label={loadState === 'loading' ? 'Reading…' : 'Read DTCs'}
          onPress={() => void readCodes()}
          loading={loadState === 'loading'}
          disabled={!isConnected}
        />

        {errorMessage != null && (
          <Text className="text-brand-red font-mono text-xs mt-3">{errorMessage}</Text>
        )}

        {lastReadAt != null && (
          <Text className="text-brand-muted font-mono text-xs mt-3">
            Last read: {lastReadAt.toLocaleTimeString()}
          </Text>
        )}

        {/* Results */}
        <View className="mt-6">
          {loadState === 'done' && codes.length === 0 && (
            <View className="items-center py-8">
              <View className="w-24 h-24 rounded-full border-2 border-brand-teal items-center justify-center mb-4">
                <MaterialCommunityIcons name="check" size={40} color="#2DE1A5" />
              </View>
              <Text className="text-brand-text font-mono-bold text-base mb-1">
                No trouble codes
              </Text>
              <Text className="text-brand-muted font-mono text-sm">
                Your ECU reports no stored DTCs
              </Text>
            </View>
          )}

          {codes.map((code) => (
            <TroubleCodeCard key={code.id} code={code} />
          ))}

          {codes.length > 0 && (
            <View className="mt-2 gap-3">
              <PillButton
                label={aiLoading ? 'Interpreting…' : 'Interpret with AI'}
                onPress={() => void interpret()}
                variant="secondary"
                loading={aiLoading}
              />
              <PillButton
                label="Clear all codes"
                onPress={confirmClear}
                variant="destructive"
                disabled={!isConnected}
              />
            </View>
          )}
        </View>

        {/* AI interpretation result */}
        {(interpretation != null || interpretationError != null) && (
          <View className="mt-6">
            <SectionHeader title="AI Interpretation" />
            <View className="bg-brand-surface rounded-2xl p-4">
              {interpretationError != null ? (
                <Text className="text-brand-red font-mono text-sm">{interpretationError}</Text>
              ) : (
                <Text className="text-brand-text font-mono text-sm leading-6">
                  {interpretation}
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
