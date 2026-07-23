import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ChatMessage } from '@/domain/entities/chat-message';
import type { MessageFeedback } from '@/presentation/viewmodels/useChatVM';
import { useT } from '@/core/i18n';

interface ChatBubbleProps {
  message: ChatMessage;
  feedback?: MessageFeedback | undefined;
}

// One assistant in the UI ("Assistente Sr") — the source (offline model vs cloud)
// is never surfaced as a model/provider name (Beta V2 §1). The subtle colour
// difference below is the only hint, and it names nothing.
const SOURCE_LABEL: Record<string, string> = {
  carpsy: 'Assistente Sr',
  claude: 'Assistente Sr',
};

const SOURCE_COLOR: Record<string, string> = {
  carpsy: 'text-brand-teal',
  claude: 'text-[#7C6AFE]',
};

const MINT = '#2DE1A5';
const AMBER = '#F5A623';

export function ChatBubble({ message, feedback }: ChatBubbleProps) {
  const t = useT();
  const isUser = message.role === 'user';
  const sourceKey = message.source ?? 'carpsy';
  const agentLabel = SOURCE_LABEL[sourceKey] ?? 'Assistente Sr';
  const agentColor = SOURCE_COLOR[sourceKey] ?? 'text-brand-teal';

  // A retrieval that leaned on unverified (Claude-origin) knowledge is flagged
  // inline. The quality signal itself is no longer a per-message thumb — it now
  // lives on the case outcome in Reports ("¿se resolvió?"), the stronger signal
  // verified by the car, captured when the owner actually knows the result.
  const usedUnverified = !isUser && (feedback?.provenance.usedUnverified ?? false);

  // Deterministic gate verdict (PLAN-002 v2 UX1) — only diagnosis messages
  // carry it. Hard violations mark the answer as unconfirmed, with the
  // contradicted facts listed; the answer itself is never hidden.
  const gate = !isUser ? message.gate : undefined;
  const hardViolations = gate?.violations.filter((v) => v.weight === 'hard') ?? [];

  return (
    <View className={`mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`rounded-2xl px-4 py-3 max-w-[85%] ${
          isUser
            ? 'bg-brand-pill rounded-tr-sm'
            : 'bg-brand-surface border border-brand-border rounded-tl-sm'
        }`}
      >
        {!isUser && (
          <Text className={`font-mono text-xs mb-1 ${agentColor}`}>{agentLabel}</Text>
        )}
        <Text
          className={`font-mono text-sm leading-5 ${
            isUser ? 'text-brand-bg' : 'text-brand-text'
          }`}
        >
          {message.content}
        </Text>

        {gate != null && (
          <View className="mt-2 pt-2 border-t border-brand-border">
            {gate.passed ? (
              <View className="flex-row items-center gap-1">
                <MaterialCommunityIcons name="shield-check-outline" size={12} color={MINT} />
                <Text className="font-mono text-[10px]" style={{ color: MINT }}>
                  {t('bubble.validated')}
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-center gap-1">
                  <MaterialCommunityIcons name="shield-alert-outline" size={12} color={AMBER} />
                  <Text className="font-mono text-[10px]" style={{ color: AMBER }}>
                    {t('bubble.unconfirmed')}
                  </Text>
                </View>
                {hardViolations.map((v, i) => (
                  <Text key={i} className="text-brand-muted font-mono text-[10px] mt-0.5">
                    · {v.detail}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}

        {usedUnverified && (
          <View className="mt-3 pt-2 border-t border-brand-border flex-row items-center gap-1">
            <MaterialCommunityIcons name="alert-outline" size={12} color={AMBER} />
            <Text className="text-brand-muted font-mono text-[10px] flex-shrink">
              {t('bubble.unverified')}
            </Text>
          </View>
        )}
      </View>
      <Text className="text-brand-muted font-mono text-xs mt-1 px-1">
        {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}
