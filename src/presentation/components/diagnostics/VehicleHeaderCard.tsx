import React from 'react';
import { View, Text, TextInput } from 'react-native';
import type { Vehicle } from '@/domain/entities/vehicle';

interface VehicleHeaderCardProps {
  vehicle: Vehicle;
  mileage: string;
  onMileageChange: (value: string) => void;
  sessionActive: boolean;
}

export function VehicleHeaderCard({
  vehicle,
  mileage,
  onMileageChange,
  sessionActive,
}: VehicleHeaderCardProps) {
  const title = [
    vehicle.make !== 'Unknown' ? vehicle.make : null,
    vehicle.model !== 'Unknown' ? vehicle.model : null,
    vehicle.year != null ? String(vehicle.year) : null,
  ]
    .filter(Boolean)
    .join(' ') || 'Unknown Vehicle';

  return (
    <View className="bg-brand-surface rounded-2xl p-4 mb-4">
      <Text className="text-brand-text font-mono-bold text-base mb-1">{title}</Text>

      {vehicle.vin != null && (
        <Text className="text-brand-teal font-mono text-xs tracking-widest mb-3">
          {vehicle.vin}
        </Text>
      )}

      {!sessionActive && (
        <View className="flex-row items-center border border-brand-border rounded-xl px-3 py-2 mt-1">
          <Text className="text-brand-muted font-mono text-xs mr-2">KM</Text>
          <TextInput
            value={mileage}
            onChangeText={onMileageChange}
            placeholder="Odometer (optional)"
            placeholderTextColor="#9A9A9A"
            keyboardType="numeric"
            className="flex-1 text-brand-text font-mono text-sm"
            returnKeyType="done"
          />
        </View>
      )}

      {sessionActive && vehicle.vin == null && (
        <Text className="text-brand-muted font-mono text-xs">VIN not available</Text>
      )}
    </View>
  );
}
