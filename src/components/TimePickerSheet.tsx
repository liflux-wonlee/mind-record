/**
 * Pick any time of day: hour, minute (5-minute steps) and AM/PM, with the
 * result shown as it's built. Used by the reminder settings for the default
 * reminder time and quiet hours. Pure JS (no native picker module).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { clockMinutes, formatClock, minutesToClock } from '@/services/reminders';
import { colors, font, radius } from '@/theme';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export function TimePickerSheet({
  visible,
  title,
  value,
  onCancel,
  onSave,
}: {
  visible: boolean;
  title: string;
  /** 'HH:MM:SS' (24-hour). */
  value: string;
  onCancel: () => void;
  onSave: (hms: string) => void;
}) {
  const [hour12, setHour12] = useState(12);
  const [minute, setMinute] = useState(0);
  const [pm, setPm] = useState(false);

  // Start from the current value each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const total = clockMinutes(value);
    const h = Math.floor(total / 60);
    setPm(h >= 12);
    setHour12(h % 12 === 0 ? 12 : h % 12);
    setMinute(total % 60);
  }, [visible, value]);

  const hms = minutesToClock(((hour12 % 12) + (pm ? 12 : 0)) * 60 + minute);
  // A value set elsewhere off the 5-minute grid (e.g. 9:07) stays selectable.
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);

  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title}>
      <Text style={styles.preview}>{formatClock(hms)}</Text>

      <View style={styles.ampmRow}>
        {[false, true].map((isPm) => (
          <Option
            key={isPm ? 'pm' : 'am'}
            label={isPm ? 'PM' : 'AM'}
            selected={pm === isPm}
            onPress={() => setPm(isPm)}
            wide
          />
        ))}
      </View>

      <Text style={styles.label}>Hour</Text>
      <View style={styles.grid}>
        {HOURS.map((h) => (
          <Option key={h} label={String(h)} selected={hour12 === h} onPress={() => setHour12(h)} />
        ))}
      </View>

      <Text style={styles.label}>Minute</Text>
      <View style={styles.grid}>
        {minutes.map((m) => (
          <Option
            key={m}
            label={`:${String(m).padStart(2, '0')}`}
            selected={minute === m}
            onPress={() => setMinute(m)}
          />
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Save" variant="save" onPress={() => onSave(hms)} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

function Option({
  label,
  selected,
  onPress,
  wide,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, wide && { flex: 1 }, selected && { backgroundColor: colors.save }]}
    >
      <Text style={[styles.optionText, selected && { color: colors.saveText, fontFamily: font.semibold }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preview: {
    fontFamily: font.extrabold,
    fontSize: 26,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  ampmRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.neutral700,
    marginTop: 10,
    marginBottom: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  option: {
    // Six to a row on a phone.
    width: '15%',
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
  },
  optionText: {
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
});
