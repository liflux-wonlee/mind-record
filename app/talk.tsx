import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { Button, Kicker } from '@/components/ui';
import { useCaptureSession } from '@/hooks/useCaptureSession';
import { dismissToTabs } from '@/nav';
import { colors, font } from '@/theme';

export default function TalkScreen() {
  const router = useRouter();
  const { autoStart } = useLocalSearchParams<{ autoStart?: string }>();
  const {
    mode,
    setMode,
    recording,
    everRecorded,
    saveOnly,
    toggleSaveOnly,
    toggleRecording,
    endCapture,
    timer,
  } = useCaptureSession();

  const didAutoStart = useRef(false);
  useEffect(() => {
    if (didAutoStart.current || autoStart !== '1' || everRecorded) return;
    didAutoStart.current = true;
    toggleRecording();
  }, [autoStart, everRecorded, toggleRecording]);

  const onToggleRecording = async () => {
    const stopped = await toggleRecording();
    if (stopped) {
      const sessionId = await endCapture();
      router.replace(sessionId ? { pathname: '/summary', params: { sessionId } } : '/summary');
    }
  };

  const onEnd = async () => {
    await endCapture();
    dismissToTabs();
  };

  return (
    <Screen scroll={false} safeBottom>
      <View style={styles.head}>
        <View style={styles.seg}>
          <SegOption
            label="Capture"
            selected={mode === 'capture'}
            onPress={() => setMode('capture')}
          />
          <SegOption
            label="Conversation"
            selected={mode === 'conv'}
            onPress={() => setMode('conv')}
            divided
          />
        </View>
        <Button
          variant="ghost"
          label="Save only"
          onPress={toggleSaveOnly}
          style={{ minHeight: 44, justifyContent: 'center' }}
          textStyle={{
            fontSize: 11,
            letterSpacing: 11 * 0.08,
            textTransform: 'uppercase',
            color: saveOnly ? colors.accent : colors.neutral600,
          }}
        />
      </View>

      <View style={styles.statusRow}>
        <Kicker style={{ color: recording ? colors.accent : colors.neutral600 }}>
          {recording ? '● Listening' : everRecorded ? 'Paused' : 'Ready'}
        </Kicker>
        <Text style={styles.timer}>{timer}</Text>
      </View>

      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {!everRecorded ? (
          <Text style={styles.idle}>
            말씀하세요. 주제를 나눌 필요 없이 한 번에 이야기하셔도 됩니다.
          </Text>
        ) : (
          <Text style={styles.idle}>
            듣고 있어요. 말씀을 마치시면 이해한 내용을 보여드릴게요.
          </Text>
        )}
      </ScrollView>

      <Waveform active={recording} />

      <View style={styles.controls}>
        <Button
          label={recording ? 'Listening… tap to stop' : everRecorded ? 'Resume' : 'Start talking'}
          onPress={onToggleRecording}
          align="flex-start"
          style={[
            styles.micButton,
            { backgroundColor: recording ? colors.neutral900 : colors.accent },
          ]}
          textStyle={{ fontSize: 16 }}
        />
        <Button
          variant="secondary"
          label="End"
          onPress={onEnd}
          style={styles.endButton}
        />
      </View>
    </Screen>
  );
}

function SegOption({
  label,
  selected,
  onPress,
  divided,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  divided?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.segOpt,
        divided && styles.segDivider,
        selected && { backgroundColor: colors.accent },
      ]}
    >
      <Text style={[styles.segText, selected && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seg: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  segOpt: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  segDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  segText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  statusRow: {
    marginTop: 22,
    borderTopWidth: 2,
    borderTopColor: colors.divider,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  timer: {
    fontFamily: font.extrabold,
    fontSize: 28,
    letterSpacing: 28 * -0.02,
    color: colors.text,
  },
  transcript: {
    flex: 1,
    marginTop: 14,
  },
  transcriptContent: {
    gap: 14,
    paddingBottom: 8,
  },
  idle: {
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 25.5,
    color: colors.neutral600,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  micButton: {
    flex: 1,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  endButton: {
    minHeight: 64,
    minWidth: 64,
  },
});
