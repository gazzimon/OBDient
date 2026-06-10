import React from 'react';
import { View, Text } from 'react-native';
import type { DtcSeverity } from '@/core/utils/dtcParser';

interface SeverityBadgeProps {
  severity: DtcSeverity;
}

const CONFIG: Record<DtcSeverity, { label: string; className: string }> = {
  critical: { label: 'CRITICAL', className: 'bg-red-900 border border-red-500' },
  warning:  { label: 'WARNING',  className: 'bg-amber-900 border border-amber-500' },
  info:     { label: 'INFO',     className: 'bg-gray-800 border border-gray-600' },
};

const TEXT_CLASS: Record<DtcSeverity, string> = {
  critical: 'text-red-400',
  warning:  'text-amber-400',
  info:     'text-gray-400',
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const { label, className } = CONFIG[severity];
  return (
    <View className={`px-2 py-0.5 rounded ${className}`}>
      <Text className={`text-xs font-semibold tracking-wider ${TEXT_CLASS[severity]}`}>
        {label}
      </Text>
    </View>
  );
}
