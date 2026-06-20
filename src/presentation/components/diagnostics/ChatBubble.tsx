import React from 'react';
import { View, Text } from 'react-native';
import type { ChatMessage } from '@/domain/entities/chat-message';

interface ChatBubbleProps {
  message: ChatMessage;
}

const SOURCE_LABEL: Record<string, string> = {
  carpsy: 'QVAC',
  claude: 'Claude',
};

const SOURCE_COLOR: Record<string, string> = {
  carpsy: 'text-brand-teal',
  claude: 'text-[#7C6AFE]',
};

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const sourceKey = message.source ?? 'carpsy';
  const agentLabel = SOURCE_LABEL[sourceKey] ?? 'QVAC';
  const agentColor = SOURCE_COLOR[sourceKey] ?? 'text-brand-teal';

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
      </View>
      <Text className="text-brand-muted font-mono text-xs mt-1 px-1">
        {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}
