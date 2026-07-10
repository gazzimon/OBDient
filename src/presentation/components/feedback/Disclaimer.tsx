// Informational-use disclaimer (audit I1).
// The app gives AI-generated diagnostic guidance on safety-relevant systems, so a
// first-run acknowledgment (DisclaimerGate) plus a persistent inline note
// (DisclaimerNote) are shown wherever advice is presented.

import React from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettingsStore } from '@/store/settingsStore';

const MINT = '#2DE1A5';

// One-liner shown under the chat input and at the foot of reports.
export const DISCLAIMER_NOTE =
  'AI-generated guidance — informational only, not a substitute for a certified mechanic.';

// Full text for the first-run acknowledgment.
const DISCLAIMER_BODY =
  'OBDient provides AI-generated diagnostic guidance from OBD-II data. It can be ' +
  'inaccurate or incomplete and is not a substitute for inspection by a certified ' +
  'mechanic. Do not rely on it for decisions affecting safety systems — brakes, ' +
  'airbags, steering or fuel. Always confirm with a qualified professional before acting.';

// Persistent one-line notice. `className` lets callers tune spacing per screen.
export function DisclaimerNote({ className = '' }: { className?: string }) {
  return (
    <Text className={`text-brand-muted font-mono text-[10px] leading-4 text-center ${className}`}>
      {DISCLAIMER_NOTE}
    </Text>
  );
}

// First-run modal. Blocks until the user acknowledges; the choice is persisted in
// settingsStore (MMKV), so it appears exactly once per install.
export function DisclaimerGate() {
  const accepted = useSettingsStore((s) => s.disclaimerAccepted);
  const accept = useSettingsStore((s) => s.setDisclaimerAccepted);

  return (
    <Modal
      visible={!accepted}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android back button must not dismiss the gate without acknowledgment.
      onRequestClose={() => {}}
    >
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View className="w-full max-w-[420px] bg-brand-surface border border-brand-border rounded-2xl p-6">
          <View className="items-center mb-4">
            <MaterialCommunityIcons name="alert-outline" size={32} color={MINT} />
            <Text className="text-brand-text font-mono-bold text-base mt-3 text-center">
              Informational use only
            </Text>
          </View>
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-6">
            {DISCLAIMER_BODY}
          </Text>
          <Pressable
            onPress={() => accept(true)}
            className="bg-brand-pill rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="font-mono-bold text-sm" style={{ color: '#0D0D0D' }}>
              I understand
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
