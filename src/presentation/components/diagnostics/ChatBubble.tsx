import React from 'react';
import { View, Text } from 'react-native';
import type { ChatMessage } from '@/domain/entities/chat-message';

interface ChatBubbleProps {
  message: ChatMessage;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';

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
          <Text className="text-brand-teal font-mono text-xs mb-1">QVAC</Text>
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
