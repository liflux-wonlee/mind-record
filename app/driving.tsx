import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { Button, Kicker } from '@/components/ui';
import { dismissToTabs } from '@/nav';
import { useApp } from '@/store';
import { colors, font } from '@/theme';

export default function DrivingScreen() {
  const router = useRouter();
  const { recording, saveOnly, toggleSaveOnly, toggleRecording, stopRecording } = useApp();

  return (
    <Screen scroll={false} dark contentStyle={{ paddingBottom: 28 }}>
      <View style={styles.head}>
        <Kicker style={{ color: colors.neutral400 }}>Driving mode</Kicker>
        <Button
          variant="ghost"
          label="Exit"
          onPress={() => {
            stopRecording();
            dismissToTabs();
          }}
          style={{ minHeight: 44, justifyContent: 'center' }}
          textStyle={styles.exitLabel}
        />
      </View>

      <Text style={styles.title}>{recording ? '듣고 있어요.' : '말씀하세요.'}</Text>
      <Text style={styles.subtitle}>
        {recording
          ? saveOnly
            ? 'Save only — AI는 끝날 때까지 조용히 있습니다.'
            : 'AI는 짧게만 대답합니다.'
          : '화면을 보지 않아도 됩니다.'}
      </Text>

      <View style={styles.spacer} />

      <Waveform active={recording} dark />

      <Pressable
        accessibilityRole="button"
        onPress={() => toggleRecording()}
        style={({ pressed }) => [
          styles.micButton,
          { backgroundColor: recording ? colors.neutral900 : pressed ? colors.accent600 : colors.accent },
        ]}
      >
        <MicIcon size={44} color={colors.bg} />
        <Text style={styles.micLabel}>{recording ? 'Stop' : 'Talk'}</Text>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={toggleSaveOnly}
          style={[styles.action, { backgroundColor: saveOnly ? colors.accent : 'transparent' }]}
        >
          <Text style={styles.actionLabel}>Save only</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            stopRecording();
            router.replace('/summary');
          }}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>끝.</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exitLabel: {
    color: colors.bg,
    fontSize: 12,
    letterSpacing: 12 * 0.08,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 28,
    fontFamily: font.extrabold,
    fontSize: 34,
    lineHeight: 35.7,
    letterSpacing: 34 * -0.02,
    color: colors.bg,
  },
  subtitle: {
    marginTop: 10,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.neutral400,
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  micButton: {
    minHeight: 220,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 22,
  },
  micLabel: {
    fontFamily: font.extrabold,
    fontSize: 26,
    color: colors.bg,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  action: {
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.neutral600,
    paddingHorizontal: 16,
  },
  actionLabel: {
    fontFamily: font.extrabold,
    fontSize: 15,
    color: colors.bg,
  },
});
