// Diagnosis: the always-open conversation home (ADR-0009).
// The chat renders unconditionally — no connection, no session required.
// Flow: user describes the problem → local intake collects the case
//       (identity, symptoms; OBD data once the adapter is connected)
//       → deterministic brief → senior (Claude) conducts to the end.
// "Read DTCs" is an in-chat action available while connected; closing the
// conversation persists it to SQLite so it shows up under Reports.

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { container } from '@/data/container';
import { useDiagnosticsVM } from '@/presentation/viewmodels/useDiagnosticsVM';
import { useChatVM } from '@/presentation/viewmodels/useChatVM';
import { useKeyboardHeight } from '@/presentation/hooks/useKeyboardHeight';
import { ChatBubble } from '@/presentation/components/diagnostics/ChatBubble';
import { createChatMessage } from '@/domain/entities/chat-message';

const MINT = '#2DE1A5';
const MUTED = '#9A9A9A';

export default function DiagnosticsScreen() {
  const connectionState = useOBDStore((s) => s.connectionState);
  const vehicle         = useOBDStore((s) => s.vehicle);
  const isConnected     = connectionState === 'connected';

  const activeSession     = useSessionStore((s) => s.activeSession);
  const startSession      = useSessionStore((s) => s.startSession);
  const endSession        = useSessionStore((s) => s.endSession);
  const resetSession      = useSessionStore((s) => s.resetSession);
  const setSessionMileage = useSessionStore((s) => s.setSessionMileage);
  const addChatMessage    = useSessionStore((s) => s.addChatMessage);

  const { codes, loadState, errorMessage, readCodes } = useDiagnosticsVM();
  const { messages, isResponding, chatError, feedback, sendMessage, sendInitialAssessment, rateMessage } = useChatVM();

  const [mileageText, setMileageText] = useState('');
  const [inputText, setInputText]     = useState('');
  const [readingDtcs, setReadingDtcs] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const inputRef  = useRef<TextInput>(null);

  // Edge-to-edge keyboard handling: pad the layout by the reported keyboard
  // height (KeyboardAvoidingView is a no-op on Android edge-to-edge).
  const keyboardHeight = useKeyboardHeight();

  const hasConversation = messages.length > 0;

  // Scroll to bottom whenever messages change or the keyboard opens
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, keyboardHeight]);

  const ensureSession = useCallback(() => {
    if (useSessionStore.getState().activeSession == null) {
      startSession(vehicle?.id ?? 'unconnected');
    }
  }, [startSession, vehicle?.id]);

  // In-chat action: read DTCs and trigger the initial assessment (intake or
  // immediate senior handoff when the case is already complete).
  const handleReadDtcs = useCallback(async () => {
    if (!isConnected || readingDtcs || isResponding) return;
    setReadingDtcs(true);
    ensureSession();

    const result = await readCodes();
    const dtcCount = result?.codes?.length ?? 0;

    // Visible case summary — deliberately NO VIN (ADR-0009 data contract
    // coherence; the identity line is enough for the owner).
    const summaryLines: string[] = [];
    if (vehicle) {
      summaryLines.push(`Vehicle: ${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ''}`);
    }
    summaryLines.push(
      dtcCount > 0 ? `DTCs found: ${dtcCount} code(s)` : 'No active DTCs found.',
    );
    addChatMessage(createChatMessage('assistant', summaryLines.join('\n')));

    await sendInitialAssessment(
      'Please give me your initial diagnostic assessment based on the vehicle data and DTCs provided.',
    );
    setReadingDtcs(false);
  }, [isConnected, readingDtcs, isResponding, ensureSession, readCodes, vehicle, addChatMessage, sendInitialAssessment]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isResponding) return;
    setInputText('');
    void sendMessage(text);
  }, [inputText, isResponding, sendMessage]);

  const handleMileageChange = useCallback((val: string) => {
    setMileageText(val.replace(/[^0-9]/g, ''));
  }, []);

  const handleMileageCommit = useCallback(() => {
    const km = mileageText.trim() !== '' ? parseInt(mileageText, 10) : null;
    setSessionMileage(km);
  }, [mileageText, setSessionMileage]);

  // Closing persists the conversation (→ Reports) before resetting state.
  const confirmCloseSession = () => {
    Alert.alert(
      'Close conversation',
      'The conversation will be saved to Reports and a new one can start any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              endSession('completed');
              const closed = useSessionStore.getState().activeSession;
              if (closed) {
                try {
                  await container.saveDiagnosticReport.execute({
                    session: closed,
                    finalParameters: useOBDStore.getState().parameters,
                  });
                } catch (err) {
                  console.warn('[Diagnosis] failed to persist session on close:', err);
                }
                container.diagnosticSession.reset(closed.id);
              }
              resetSession();
              setMileageText('');
              setInputText('');
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <View className="flex-1" style={{ paddingBottom: keyboardHeight }}>
        {/* Header */}
        <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-brand-text font-mono-bold text-base">
              {vehicle
                ? [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')
                : 'Diagnosis'}
            </Text>
            {vehicle?.vin && (
              <Text className="text-brand-teal font-mono text-xs tracking-widest mt-0.5">
                {vehicle.vin}
              </Text>
            )}
          </View>
          {hasConversation && (
            <Pressable onPress={confirmCloseSession} className="ml-3 p-2 active:opacity-60">
              <MaterialCommunityIcons name="close-circle-outline" size={22} color={MUTED} />
            </Pressable>
          )}
        </View>

        {/* Connection banner — informative, never blocking */}
        {!isConnected && (
          <View className="mx-4 mb-2 flex-row items-center gap-2 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
            <MaterialCommunityIcons name="bluetooth-off" size={14} color={MUTED} />
            <Text className="text-brand-muted font-mono text-xs flex-1">
              Adapter not connected — live data unavailable. Connect in Settings.
            </Text>
          </View>
        )}

        <View className="h-px bg-brand-teal opacity-40 mx-4" />

        {/* DTC chips + in-chat actions */}
        <View className="px-4 pt-3 pb-1 flex-row flex-wrap items-center gap-2">
          {codes.map((code) => (
            <View key={code.id} className="border border-brand-teal rounded-md px-2 py-0.5">
              <Text className="text-brand-teal font-mono text-xs">{code.code}</Text>
            </View>
          ))}

          {codes.length === 0 && loadState === 'done' && (
            <View className="flex-row items-center gap-1">
              <MaterialCommunityIcons name="check-circle-outline" size={14} color={MINT} />
              <Text className="text-brand-teal font-mono text-xs">No active DTCs</Text>
            </View>
          )}

          {isConnected && (
            <Pressable
              onPress={() => void handleReadDtcs()}
              disabled={readingDtcs || isResponding}
              className={`border border-brand-pill rounded-md px-2 py-0.5 active:opacity-60 ${
                readingDtcs || isResponding ? 'opacity-30' : ''
              }`}
            >
              <Text className="font-mono text-xs" style={{ color: MINT }}>
                {readingDtcs ? 'Reading…' : codes.length > 0 ? 'Re-read DTCs' : 'Read DTCs'}
              </Text>
            </Pressable>
          )}

          {isConnected && (
            <View className="flex-row items-center gap-1 ml-auto">
              <Text className="text-brand-muted font-mono text-xs">km</Text>
              <TextInput
                value={mileageText}
                onChangeText={handleMileageChange}
                onEndEditing={handleMileageCommit}
                placeholder="odometer"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                maxLength={7}
                className="bg-brand-surface rounded-md px-2 py-0.5 text-brand-text font-mono text-xs"
                style={{ minWidth: 76 }}
              />
            </View>
          )}
        </View>

        {errorMessage != null && (
          <Text className="text-brand-red font-mono text-xs px-4 pt-1">{errorMessage}</Text>
        )}

        {/* Chat messages */}
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 8, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        >
          {!hasConversation && (
            <View className="flex-1 items-center justify-center px-6">
              <MaterialCommunityIcons name="car-wrench" size={36} color={MUTED} />
              <Text className="text-brand-muted font-mono text-sm text-center mt-4 leading-5">
                Tell me what's going on with your vehicle.{'\n'}
                I'll collect the case — vehicle, symptoms, OBD data — and bring in
                the senior diagnostician.
              </Text>
            </View>
          )}

          {messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              feedback={feedback[msg.id]}
              onRate={rateMessage}
            />
          ))}

          {isResponding && (
            <View className="items-start mb-3">
              <View className="bg-brand-surface border border-brand-border rounded-2xl rounded-tl-sm px-4 py-3">
                <Text className="text-brand-teal font-mono text-xs mb-1">QVAC</Text>
                <ActivityIndicator size="small" color={MINT} />
              </View>
            </View>
          )}

          {chatError != null && (
            <Text className="text-brand-red font-mono text-xs text-center mb-3">{chatError}</Text>
          )}
        </ScrollView>

        {/* Input bar — always enabled */}
        <View className="px-4 pb-4 pt-2 flex-row items-end gap-3 border-t border-brand-border">
          <TextInput
            ref={inputRef}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Describe symptoms or ask anything…"
            placeholderTextColor={MUTED}
            multiline
            maxLength={500}
            className="flex-1 bg-brand-surface rounded-2xl px-4 py-3 text-brand-text font-mono text-sm leading-5"
            style={{ maxHeight: 120 }}
            returnKeyType="default"
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={inputText.trim() === '' || isResponding}
            className={`w-11 h-11 rounded-full bg-brand-pill items-center justify-center active:opacity-70 ${
              inputText.trim() === '' || isResponding ? 'opacity-30' : ''
            }`}
          >
            <MaterialCommunityIcons name="send" size={18} color="#0D0D0D" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
