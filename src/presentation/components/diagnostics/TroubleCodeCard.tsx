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
      className="bg-surface rounded-xl p-4 mb-3 active:opacity-70"
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-white font-bold text-base tracking-widest">
          {code.code}
        </Text>
        <SeverityBadge severity={code.severity} />
      </View>

      <Text className="text-gray-300 text-sm leading-5">
        {code.description}
      </Text>

      {code.interpretation != null && (
        <Text className="text-teal text-xs mt-2 leading-4">
          {code.interpretation}
        </Text>
      )}

      <Text className="text-gray-600 text-xs mt-2">
        {code.detectedAt.toLocaleTimeString()}
      </Text>
    </Pressable>
  );
}
