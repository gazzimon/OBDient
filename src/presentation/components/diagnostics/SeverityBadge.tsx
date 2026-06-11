import React from 'react';
import { View, Text } from 'react-native';
import type { DtcSeverity } from '@/core/utils/dtcParser';

interface SeverityBadgeProps {
  severity: DtcSeverity;
}

// QVAC style: outlined badges, never filled
const CONFIG: Record<DtcSeverity, { label: string; container: string; text: string }> = {
  critical: { label: 'CRITICAL', container: 'border-brand-red',   text: 'text-brand-red' },
  warning:  { label: 'WARNING',  container: 'border-brand-amber', text: 'text-brand-amber' },
  info:     { label: 'INFO',     container: 'border-brand-muted', text: 'text-brand-muted' },
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const { label, container, text } = CONFIG[severity];
  return (
    <View className={`px-2 py-0.5 rounded-md border ${container}`}>
      <Text className={`text-xs font-mono ${text}`}>{label}</Text>
    </View>
  );
}
