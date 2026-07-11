// Saved session detail: final parameter snapshot, DTCs, and the chat history.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { useSessionStore } from '@/store/sessionStore';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { TroubleCodeCard } from '@/presentation/components/diagnostics/TroubleCodeCard';
import { DisclaimerNote } from '@/presentation/components/feedback/Disclaimer';
import type { DiagnosticSession } from '@/domain/entities/diagnostic-session';
import type { ObdParameter } from '@/domain/entities/obd-parameter';
import type { OutcomeResolved } from '@/domain/repositories/i-report.repository';
import type { ChatMessage } from '@/domain/entities/chat-message';

function ParameterRow({ param }: { param: ObdParameter }) {
  return (
    <View className="flex-row items-center justify-between py-2 border-b border-brand-border">
      <Text className="text-brand-muted font-mono text-sm">{param.name}</Text>
      <Text className="text-brand-text font-mono text-sm">
        {param.value} {param.unit}
      </Text>
    </View>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View className={`mb-2 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`rounded-2xl px-3 py-2 max-w-[85%] ${
          isUser ? 'bg-brand-teal' : 'bg-brand-surface'
        }`}
      >
        <Text
          className={`font-mono text-sm leading-5 ${
            isUser ? 'text-brand-bg' : 'text-brand-text'
          }`}
        >
          {message.content}
        </Text>
      </View>
      <Text className="text-brand-muted font-mono text-xs mt-0.5 px-1">
        {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}

export default function InterpretationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const resumeSession = useSessionStore((s) => s.resumeSession);
  const [session, setSession] = useState<DiagnosticSession | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Whether this case already has an outcome — gates the resume prompt below.
  const [hasOutcome, setHasOutcome] = useState(true);

  useEffect(() => {
    if (id == null) return;
    container.reportRepo
      .getSessionById(id)
      .then((s) => (s != null ? setSession(s) : setNotFound(true)))
      .catch(() => setNotFound(true));
    container.reportRepo
      .getOutcome(id)
      .then((o) => setHasOutcome(o != null))
      .catch(() => setHasOutcome(true));
  }, [id]);

  // Reopen this saved case for continued chat: load it as the active session,
  // seed the intake state so the next turn skips re-interviewing, and jump to
  // the Diagnosis tab where the full history is already on screen.
  const proceedResume = useCallback(() => {
    if (session == null) return;
    resumeSession(session);
    container.diagnosticSession.resume(session.id);
    router.replace('/diagnostics');
  }, [session, resumeSession, router]);

  // Persist the outcome (moves confidence + enriches the seed) then continue.
  const saveOutcomeAndResume = useCallback(
    (resolved: OutcomeResolved) => {
      if (session != null) {
        void container.reportRepo.saveOutcome(session.id, { resolved, rootCause: null });
      }
      proceedResume();
    },
    [session, proceedResume],
  );

  // Anthropological trigger: reopening a case is the natural moment to learn
  // whether the previous fix worked. Ask once — only when we don't have an
  // outcome yet — so the strongest signal (the car's own result) gets captured
  // exactly when the owner is back and the case is fresh.
  const handleResume = useCallback(() => {
    if (session == null) return;
    if (hasOutcome) { proceedResume(); return; }
    Alert.alert(
      'Retomar consulta',
      '¿La reparación anterior funcionó?',
      [
        { text: 'Sí, se resolvió', onPress: () => saveOutcomeAndResume('yes') },
        { text: 'No, sigue igual', onPress: () => saveOutcomeAndResume('no') },
        { text: 'Ahora no', style: 'cancel', onPress: proceedResume },
      ],
    );
  }, [session, hasOutcome, proceedResume, saveOutcomeAndResume]);

  const params = session != null ? Object.values(session.parameters) : [];

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      {/* Top bar: back arrow + centered title (QVAC pattern) */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={() => router.back()} hitSlop={12} className="active:opacity-60">
          <MaterialCommunityIcons name="arrow-left" size={22} color="#F5F5F5" />
        </Pressable>
        <Text className="flex-1 text-center text-brand-text font-mono text-base mr-6">
          Session Report
        </Text>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {notFound && (
          <Text className="text-brand-muted font-mono text-sm text-center py-12">
            Session not found.
          </Text>
        )}

        {session != null && (
          <>
            <Text className="text-brand-teal font-mono-bold text-sm mb-1">
              {session.startedAt.toLocaleDateString()}
            </Text>
            <Text className="text-brand-muted font-mono text-xs mb-4">
              {session.startedAt.toLocaleTimeString()}
              {session.endedAt != null && ` — ${session.endedAt.toLocaleTimeString()}`}
              {' · '}
              {session.status}
            </Text>

            {/* Reopen the case and keep chatting with CARpsy, full history intact */}
            <Pressable
              onPress={handleResume}
              className="flex-row items-center justify-center gap-2 border border-brand-teal rounded-xl px-4 py-3 mb-6 active:opacity-70"
            >
              <MaterialCommunityIcons name="chat-plus-outline" size={16} color="#2DE1A5" />
              <Text className="font-mono text-sm" style={{ color: '#2DE1A5' }}>
                Continue this consultation
              </Text>
            </Pressable>

            <SectionHeader title={`Trouble Codes (${session.troubleCodes.length})`} />
            {session.troubleCodes.length === 0 ? (
              <Text className="text-brand-muted font-mono text-sm mb-6">
                No DTCs recorded in this session.
              </Text>
            ) : (
              <View className="mb-3">
                {session.troubleCodes.map((code) => (
                  <TroubleCodeCard key={code.id} code={code} />
                ))}
              </View>
            )}

            <SectionHeader title="Final Parameters" />
            {params.length === 0 ? (
              <Text className="text-brand-muted font-mono text-sm">
                No parameter snapshot recorded.
              </Text>
            ) : (
              <View className="bg-brand-surface rounded-2xl px-4 py-2">
                {params.map((param) => (
                  <ParameterRow key={param.pid} param={param} />
                ))}
              </View>
            )}

            {session.messages.length > 0 && (
              <View className="mt-6">
                <SectionHeader title={`Chat History (${session.messages.length})`} />
                <View className="mt-2">
                  {session.messages.map((msg) => (
                    <ChatBubble key={msg.id} message={msg} />
                  ))}
                </View>
              </View>
            )}

            {/* Persistent informational-use notice (audit I1) */}
            <DisclaimerNote className="mt-8 px-2" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
