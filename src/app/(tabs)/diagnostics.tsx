// Diagnostics: vehicle-anchored diagnostic sessions with multi-turn QVAC chat.
// Flow: connect vehicle → enter mileage (optional) → Start Diagnosis
//       → DTCs read automatically → QVAC opens with initial assessment
//       → technician chats freely → close session

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOBDStore } from '@/store/obdStore';
import { useSessionStore } from '@/store/sessionStore';
import { useDiagnosticsVM } from '@/presentation/viewmodels/useDiagnosticsVM';
import { useChatVM } from '@/presentation/viewmodels/useChatVM';
import { VehicleHeaderCard } from '@/presentation/components/diagnostics/VehicleHeaderCard';
import { ChatBubble } from '@/presentation/components/diagnostics/ChatBubble';
import { TroubleCodeCard } from '@/presentation/components/diagnostics/TroubleCodeCard';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { createChatMessage } from '@/domain/entities/chat-message';

const MINT = '#2DE1A5';

export default function DiagnosticsScreen() {
  const connectionState = useOBDStore((s) => s.connectionState);
  const vehicle         = useOBDStore((s) => s.vehicle);
  const isConnected     = connectionState === 'connected';

  const activeSession     = useSessionStore((s) => s.activeSession);
  const startSession      = useSessionStore((s) => s.startSession);
  const resetSession      = useSessionStore((s) => s.resetSession);
  const pendingMileage    = useSessionStore((s) => s.pendingMileage);
  const setPendingMileage = useSessionStore((s) => s.setPendingMileage);
  const addChatMessage    = useSessionStore((s) => s.addChatMessage);

  const { codes, loadState, errorMessage, readCodes, clearCodes } = useDiagnosticsVM();
  const { messages, isResponding, chatError, feedback, sendMessage, sendInitialAssessment, rateMessage } = useChatVM();

  const [mileageText, setMileageText]   = useState('');
  const [inputText, setInputText]       = useState('');
  const [sessionStarting, setSessionStarting] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const inputRef  = useRef<TextInput>(null);

  const sessionActive = activeSession !== null;

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleStartDiagnosis = useCallback(async () => {
    if (!vehicle || !isConnected) return;
    setSessionStarting(true);

    // Parse mileage
    const km = mileageText.trim() !== '' ? parseInt(mileageText, 10) : null;
    if (km !== null) setPendingMileage(km);

    // Start session
    startSession(vehicle.id);

    // Read DTCs
    const result = await readCodes();

    // Inject a system context message visible in the chat
    const dtcCount = result?.codes?.length ?? codes.length;
    const summaryLines: string[] = [];
    summaryLines.push(`Vehicle: ${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ''}`);
    if (vehicle.vin) summaryLines.push(`VIN: ${vehicle.vin}`);
    if (km != null) summaryLines.push(`Odometer: ${km.toLocaleString()} km`);
    summaryLines.push(
      dtcCount > 0
        ? `DTCs found: ${dtcCount} code(s)`
        : 'No active DTCs found.',
    );
    addChatMessage(createChatMessage('assistant', summaryLines.join('\n')));

    // Ask QVAC for initial assessment
    await sendInitialAssessment('Please give me your initial diagnostic assessment based on the vehicle data and DTCs provided.');

    setSessionStarting(false);
  }, [vehicle, isConnected, mileageText, codes.length, startSession, readCodes, setPendingMileage, addChatMessage, sendInitialAssessment]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isResponding) return;
    setInputText('');
    void sendMessage(text);
  }, [inputText, isResponding, sendMessage]);

  const handleMileageChange = useCallback((val: string) => {
    setMileageText(val.replace(/[^0-9]/g, ''));
  }, []);

  const confirmCloseSession = () => {
    Alert.alert(
      'Close session',
      'The current diagnostic session will be closed. You can start a new one at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: () => {
            resetSession();
            setMileageText('');
            setInputText('');
          },
        },
      ],
    );
  };

  // ── Not connected ────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
        <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}>
          <SectionHeader title="Diagnostics" />
          <View className="bg-brand-surface rounded-2xl p-6 items-center mt-4">
            <MaterialCommunityIcons name="car-off" size={40} color="#9A9A9A" />
            <Text className="text-brand-muted font-mono text-sm text-center mt-3 leading-5">
              Connect to a vehicle in Settings to start a diagnostic session.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Connected, no active session ─────────────────────────────────────────
  if (!sessionActive) {
    return (
      <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
        <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}>
          <SectionHeader title="Diagnostics" />

          {vehicle && (
            <VehicleHeaderCard
              vehicle={vehicle}
              mileage={mileageText}
              onMileageChange={handleMileageChange}
              sessionActive={false}
            />
          )}

          {errorMessage != null && (
            <Text className="text-brand-red font-mono text-xs mb-3">{errorMessage}</Text>
          )}

          <PillButton
            label={sessionStarting ? 'Starting…' : 'Start Diagnosis'}
            onPress={() => void handleStartDiagnosis()}
            loading={sessionStarting}
            disabled={sessionStarting}
          />

          <Text className="text-brand-muted font-mono text-xs text-center mt-3">
            Reads DTCs from the ECU and opens a QVAC session
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Active session — chat UI ──────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
          <View className="flex-1">
            {vehicle && (
              <Text className="text-brand-text font-mono-bold text-base">
                {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')}
              </Text>
            )}
            {vehicle?.vin && (
              <Text className="text-brand-teal font-mono text-xs tracking-widest mt-0.5">
                {vehicle.vin}
              </Text>
            )}
          </View>
          <Pressable onPress={confirmCloseSession} className="ml-3 p-2 active:opacity-60">
            <MaterialCommunityIcons name="close-circle-outline" size={22} color="#9A9A9A" />
          </Pressable>
        </View>

        <View className="h-px bg-brand-teal opacity-40 mx-4" />

        {/* DTC chips */}
        {codes.length > 0 && (
          <View className="px-4 pt-3 pb-1 flex-row flex-wrap gap-2">
            {codes.map((code) => (
              <View key={code.id} className="border border-brand-teal rounded-md px-2 py-0.5">
                <Text className="text-brand-teal font-mono text-xs">{code.code}</Text>
              </View>
            ))}
          </View>
        )}

        {codes.length === 0 && loadState === 'done' && (
          <View className="px-4 pt-3 pb-1 flex-row items-center gap-2">
            <MaterialCommunityIcons name="check-circle-outline" size={14} color={MINT} />
            <Text className="text-brand-teal font-mono text-xs">No active DTCs</Text>
          </View>
        )}

        {/* Chat messages */}
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        >
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

        {/* Input bar */}
        <View className="px-4 pb-4 pt-2 flex-row items-end gap-3 border-t border-brand-border">
          <TextInput
            ref={inputRef}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Describe symptoms or ask QVAC…"
            placeholderTextColor="#9A9A9A"
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
