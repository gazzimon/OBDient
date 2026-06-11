import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SeverityBadge } from './SeverityBadge';
import type { TroubleCode } from '@/domain/entities/trouble-code';

interface TroubleCodeCardProps {
  code: TroubleCode;
  onPress?: (code: TroubleCode) => void;
}

export function TroubleCodeCard({ code, onPress }: TroubleCodeCardProps) {
  return (
    <Pressable
      onPress={() => onPress?.(code)}
      className="bg-brand-surface rounded-2xl p-4 mb-3 active:opacity-70"
    >
      {/* Header row with thin separator below — QVAC card pattern */}
      <View className="flex-row items-center justify-between pb-2 mb-3 border-b border-brand-border">
        <Text className="text-brand-text font-mono-bold text-base">
          {code.code}
        </Text>
        <SeverityBadge severity={code.severity} />
      </View>

      <Text className="text-brand-text font-mono text-sm leading-5">
        {code.description}
      </Text>

      {code.interpretation != null && (
        <Text className="text-brand-teal font-mono text-xs mt-2 leading-4">
          {code.interpretation}
        </Text>
      )}

      <Text className="text-brand-muted font-mono text-xs mt-2">
        {code.detectedAt.toLocaleTimeString()}
      </Text>
    </Pressable>
  );
}
