// Base circular gauge — 270° arc driven by a Reanimated SharedValue.
// The progress arc animates on the UI thread; text re-renders at polling rate (~2 Hz).

import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface CircularGaugeProps {
  value: number;
  min: number;
  max: number;
  unit: string;
  label: string;
  // Number of decimal places for the center text (default 0)
  precision?: number;
  // Arc fill color — defaults to teal, caller changes to amber/red on alert
  color?: string;
  size?: number;
  strokeWidth?: number;
}

const TEAL = '#1D9E75';
const TRACK_COLOR = '#1F1F1F';
// 270° sweep: arc covers 75% of circumference, gap covers 25% (bottom center)
const SWEEP_RATIO = 0.75;
// Gap starts at 225° clockwise from 12 o'clock → 135° in SVG coords (0 = 3 o'clock)
const START_ROTATION = 135;

export function CircularGauge({
  value,
  min,
  max,
  unit,
  label,
  precision = 0,
  color = TEAL,
  size = 160,
  strokeWidth = 12,
}: CircularGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = SWEEP_RATIO * circumference;
  const gapLength = circumference - arcLength;

  const progress = useSharedValue(0);

  useEffect(() => {
    const clamped = Math.min(Math.max((value - min) / (max - min), 0), 1);
    progress.value = withTiming(clamped, { duration: 400 });
  }, [value, min, max, progress]);

  const animatedProps = useAnimatedProps(() => ({
    // Offset from arcLength down to 0 as progress goes 0→1
    strokeDashoffset: arcLength * (1 - progress.value),
  }));

  const displayText = isNaN(value) ? '--' : value.toFixed(precision);

  return (
    <View className="items-center">
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* Background track — full 270° arc */}
          <Circle
            cx={cx}
            cy={cx}
            r={radius}
            stroke={TRACK_COLOR}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="butt"
            strokeDasharray={[arcLength, gapLength]}
            rotation={START_ROTATION}
            origin={`${cx},${cx}`}
          />
          {/* Progress arc */}
          <AnimatedCircle
            cx={cx}
            cy={cx}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={[arcLength, gapLength]}
            rotation={START_ROTATION}
            origin={`${cx},${cx}`}
            animatedProps={animatedProps}
          />
        </Svg>

        {/* Value + unit centered over the SVG */}
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          className="items-center justify-center"
        >
          <Text
            className="text-white font-bold"
            style={{ fontSize: size * 0.175 }}
          >
            {displayText}
          </Text>
          <Text className="text-gray-400 text-xs mt-0.5">{unit}</Text>
        </View>
      </View>

      <Text className="text-gray-500 text-xs mt-1 tracking-wide uppercase">
        {label}
      </Text>
    </View>
  );
}
