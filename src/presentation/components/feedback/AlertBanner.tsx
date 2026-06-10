import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { AlertSeverity } from '@/core/constants/pids';

interface AlertBannerProps {
  severity: AlertSeverity;
  message: string;
  onDismiss: () => void;
}

const CONFIG: Record<AlertSeverity, { container: string; text: string; label: string }> = {
  critical: {
    container: 'bg-red-950 border border-red-600',
    text:      'text-red-300',
    label:     'CRITICAL',
  },
  warning: {
    container: 'bg-amber-950 border border-amber-600',
    text:      'text-amber-300',
    label:     'WARNING',
  },
};

export function AlertBanner({ severity, message, onDismiss }: AlertBannerProps) {
  const { container, text, label } = CONFIG[severity];

  return (
    <View className={`mx-4 mb-3 px-4 py-3 rounded-xl flex-row items-start justify-between ${container}`}>
      <View className="flex-1 mr-3">
        <Text className={`text-xs font-bold tracking-widest mb-1 ${text}`}>
          {label}
        </Text>
        <Text className={`text-sm leading-5 ${text}`}>{message}</Text>
      </View>
      <Pressable onPress={onDismiss} className="mt-0.5 active:opacity-60" hitSlop={8}>
        <Text className={`text-lg leading-none ${text}`}>✕</Text>
      </Pressable>
    </View>
  );
}
