import React from 'react';
import { CircularGauge } from './CircularGauge';
import type { ObdParameter } from '@/domain/entities/obd-parameter';

const COLORS = { critical: '#EF4444', warning: '#F59E0B', normal: '#1D9E75' };

interface TempGaugeProps {
  param: ObdParameter | undefined;
}

export function TempGauge({ param }: TempGaugeProps) {
  const value = param?.value ?? 0;
  const color =
    param?.alert?.severity === 'critical' ? COLORS.critical :
    param?.alert?.severity === 'warning'  ? COLORS.warning  :
    COLORS.normal;

  return (
    <CircularGauge
      value={value}
      min={-40}
      max={130}
      unit="°C"
      label="Coolant Temp"
      color={color}
    />
  );
}
