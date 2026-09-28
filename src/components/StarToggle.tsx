/**
 * The favorite star used on records and topics (tasks draw their own, in
 * their row). A 44pt target around a 22pt star; the caller owns the state
 * and the save, so a list can update its own copy of the row.
 */
import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { StarIcon } from '@/components/Icon';
import { colors } from '@/theme';

/** Filled-star gold, same as a starred task. */
export const STAR_GOLD = '#e0a526';

export function StarToggle({
  starred,
  onToggle,
  label = 'favorite',
  size = 22,
  style,
}: {
  starred: boolean;
  onToggle: () => void;
  /** What's being starred, for the screen reader ("Add record to favorites"). */
  label?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: starred }}
      accessibilityLabel={starred ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      onPress={onToggle}
      hitSlop={4}
      style={({ pressed }) => [styles.hit, pressed && { opacity: 0.6 }, style]}
    >
      <StarIcon size={size} filled={starred} color={starred ? STAR_GOLD : colors.neutral500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
