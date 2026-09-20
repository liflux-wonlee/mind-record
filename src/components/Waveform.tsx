/**
 * The 24-bar level meter from Talk's Capture and Conversation panels.
 *
 * Mirrors the prototype's `bars()` + `@keyframes mePulse`: bars sit at 15% when
 * idle, and pulse between 30% and 100% with a per-bar duration and delay while
 * recording.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

const BAR_COUNT = 24;
const DEFAULT_HEIGHT = 40;
const IDLE = 0.15;

export function Waveform({
  active,
  dark = false,
  height = DEFAULT_HEIGHT,
}: {
  active: boolean;
  dark?: boolean;
  height?: number;
}) {
  const values = useMemo(
    () => Array.from({ length: BAR_COUNT }, () => new Animated.Value(IDLE)),
    []
  );
  const loops = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loops.current.forEach((l) => l.stop());
    loops.current = [];

    if (!active) {
      values.forEach((v) => v.setValue(IDLE));
      return;
    }

    values.forEach((v, i) => {
      const duration = (0.6 + (i % 5) * 0.13) * 1000;
      const delay = (i % 7) * 70;
      v.setValue(0.3);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: duration / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(v, {
            toValue: 0.3,
            duration: duration / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      );
      loops.current.push(loop);
      setTimeout(() => loop.start(), delay);
    });

    return () => {
      loops.current.forEach((l) => l.stop());
      loops.current = [];
    };
  }, [active, values]);

  const barColor = active ? colors.accent : dark ? colors.neutral700 : colors.neutral300;

  return (
    <View style={[styles.row, dark && styles.rowDark, { height }]}>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor: barColor,
              height: v.interpolate({
                inputRange: [0, 1],
                outputRange: [0, height],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'flex-end',
  },
  rowDark: {
    marginBottom: 16,
  },
  bar: {
    width: 5,
  },
});
