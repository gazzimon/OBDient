import React from 'react';
import { View, Text } from 'react-native';
import type { ConnectionState } from '@/store/obdStore';

interface ConnectionStatusProps {
  state: ConnectionState;
  deviceName?: string | null;
}

const CONFIG: Record<ConnectionState, { dot: string; label: string }> = {
  connected:    { dot: 'bg-teal',        label: 'Connected'    },
  connecting:   { dot: 'bg-amber-400',   label: 'Connecting…'  },
  disconnected: { dot: 'bg-gray-600',    label: 'Disconnected' },
};

export function ConnectionStatus({ state, deviceName }: ConnectionStatusProps) {
  const { dot, label } = CONFIG[state];

  return (
    <View className="flex-row items-center gap-2">
      <View className={`w-2 h-2 rounded-full ${dot}`} />
      <Text className="text-gray-400 text-xs">
        {state === 'connected' && deviceName ? deviceName : label}
      </Text>
    </View>
  );
}
