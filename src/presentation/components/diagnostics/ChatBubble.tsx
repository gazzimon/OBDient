import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ChatMessage } from '@/domain/entities/chat-message';
import type { MessageFeedback, Rating } from '@/presentation/viewmodels/useChatVM';

interface ChatBubbleProps {
  message: ChatMessage;
  feedback?: MessageFeedback | undefined;
  onRate?: ((messageId: string, rating: Rating) => void) | undefined;
}

const SOURCE_LABEL: Record<string, string> = {
  carpsy: 'QVAC',
  claude: 'Claude',
};

const SOURCE_COLOR: Record<string, string> = {
  carpsy: 'text-brand-teal',
  claude: 'text-[#7C6AFE]',
};

const MINT = '#2DE1A5';
const AMBER = '#F5A623';
const MUTED = '#9A9A9A';

export function ChatBubble({ message, feedback, onRate }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const sourceKey = message.source ?? 'carpsy';
  const agentLabel = SOURCE_LABEL[sourceKey] ?? 'QVAC';
  const agentColor = SOURCE_COLOR[sourceKey] ?? 'text-brand-teal';

  // Show the feedback footer only on assistant messages that went through retrieval.
  const showFeedback = !isUser && feedback != null && onRate != null;
  const usedUnverified = feedback?.provenance.usedUnverified ?? false;
  const rating = feedback?.rating ?? null;

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
                  validated against vehicle data
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-center gap-1">
                  <MaterialCommunityIcons name="shield-alert-outline" size={12} color={AMBER} />
                  <Text className="font-mono text-[10px]" style={{ color: AMBER }}>
                    UNCONFIRMED — contradicts vehicle data
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

        {showFeedback && (
          <View className="mt-3 pt-2 border-t border-brand-border flex-row items-center justify-between">
            {usedUnverified ? (
              <View className="flex-row items-center gap-1 flex-1 mr-2">
                <MaterialCommunityIcons name="alert-outline" size={12} color={AMBER} />
                <Text className="text-brand-muted font-mono text-[10px] flex-shrink">
                  contains unverified suggestion
                </Text>
              </View>
            ) : (
              <View className="flex-1" />
            )}

            <View className="flex-row items-center gap-3">
              <Pressable
                onPress={() => rating == null && onRate(message.id, 'up')}
                hitSlop={8}
                disabled={rating != null}
                className="active:opacity-60"
              >
                <MaterialCommunityIcons
                  name={rating === 'up' ? 'thumb-up' : 'thumb-up-outline'}
                  size={16}
                  color={rating === 'up' ? MINT : MUTED}
                />
              </Pressable>
              <Pressable
                onPress={() => rating == null && onRate(message.id, 'down')}
                hitSlop={8}
                disabled={rating != null}
                className="active:opacity-60"
              >
                <MaterialCommunityIcons
                  name={rating === 'down' ? 'thumb-down' : 'thumb-down-outline'}
                  size={16}
                  color={rating === 'down' ? AMBER : MUTED}
                />
              </Pressable>
            </View>
          </View>
        )}
      </View>
      <Text className="text-brand-muted font-mono text-xs mt-1 px-1">
        {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}
