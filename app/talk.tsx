import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { Button, Kicker } from '@/components/ui';
import { useCaptureSession } from '@/hooks/useCaptureSession';
import { useConversationSession } from '@/hooks/useConversationSession';
import { dismissToTabs } from '@/nav';
import { colors, font } from '@/theme';

type ScreenMode = 'capture' | 'conv';

export default function TalkScreen() {
  const router = useRouter();
  const { autoStart, mode: initialMode } = useLocalSearchParams<{ autoStart?: string; mode?: string }>();
  const [mode, setMode] = useState<ScreenMode>(initialMode === 'conv' ? 'conv' : 'capture');

  const capture = useCaptureSession();
  const conversation = useConversationSession();

  const captureStarted = capture.everRecorded;
  const conversationStarted = conversation.turns.length > 0 || conversation.state !== 'idle';
  // Switching modes mid-flow would orphan whichever session already
  // started -- once either has begun, the toggle stops responding.
  const modeLocked = mode === 'capture' ? captureStarted : conversationStarted;

  const didAutoStart = useRef(false);
  useEffect(() => {
    if (didAutoStart.current || autoStart !== '1' || mode !== 'capture' || captureStarted) return;
    didAutoStart.current = true;
    capture.toggleRecording();
  }, [autoStart, mode, captureStarted, capture]);

  const onToggleRecording = async () => {
    const stopped = await capture.toggleRecording();
    if (stopped) {
      const sessionId = await capture.endCapture();
      router.replace(sessionId ? { pathname: '/summary', params: { sessionId } } : '/summary');
    }
  };

  const onCancelCapture = () => {
    if (!captureStarted) {
      dismissToTabs();
      return;
    }
    Alert.alert('Discard this recording?', 'What you said so far will not be saved.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await capture.cancelCapture();
          dismissToTabs();
        },
      },
    ]);
  };

  const onCancelConversation = () => {
    if (!conversationStarted) {
      dismissToTabs();
      return;
    }
    Alert.alert('Discard this conversation?', 'What you said so far will not be saved.', [
      { text: 'Keep talking', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await conversation.cancelConversation();
          dismissToTabs();
        },
      },
    ]);
  };

  return (
    <Screen scroll={false} safeBottom>
      <View style={styles.head}>
        <View style={styles.seg}>
          <SegOption
            label="Capture"
            selected={mode === 'capture'}
            onPress={() => !modeLocked && setMode('capture')}
          />
          <SegOption
            label="Conversation"
            selected={mode === 'conv'}
            onPress={() => !modeLocked && setMode('conv')}
            divided
          />
        </View>
        {mode === 'capture' ? (
          <Button
            variant="ghost"
            label="Save only"
            onPress={capture.toggleSaveOnly}
            style={{ minHeight: 44, justifyContent: 'center' }}
            textStyle={{
              fontSize: 11,
              letterSpacing: 11 * 0.08,
              textTransform: 'uppercase',
              color: capture.saveOnly ? colors.accent : colors.neutral600,
            }}
          />
        ) : null}
      </View>

      {mode === 'capture' ? (
        <CapturePanel capture={capture} onToggleRecording={onToggleRecording} onCancel={onCancelCapture} />
      ) : (
        <ConversationPanel conversation={conversation} onCancel={onCancelConversation} />
      )}
    </Screen>
  );
}

function CapturePanel({
  capture,
  onToggleRecording,
  onCancel,
}: {
  capture: ReturnType<typeof useCaptureSession>;
  onToggleRecording: () => void;
  onCancel: () => void;
}) {
  const { recording, everRecorded, timer } = capture;
  return (
    <>
      <View style={styles.statusRow}>
        <Kicker style={{ color: recording ? colors.accent : colors.neutral600 }}>
          {recording ? '● Listening' : everRecorded ? 'Paused' : 'Ready'}
        </Kicker>
        <Text style={styles.timer}>{timer}</Text>
      </View>

      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {!everRecorded ? (
          <Text style={styles.idle}>말씀하세요. 주제를 나눌 필요 없이 한 번에 이야기하셔도 됩니다.</Text>
        ) : (
          <Text style={styles.idle}>듣고 있어요. 말씀을 마치시면 이해한 내용을 보여드릴게요.</Text>
        )}
      </ScrollView>

      <Waveform active={recording} />

      <View style={styles.controls}>
        <Button
          label={recording ? 'Listening… tap to stop' : everRecorded ? 'Resume' : 'Start talking'}
          onPress={onToggleRecording}
          align="flex-start"
          style={[styles.micButton, { backgroundColor: recording ? colors.neutral900 : colors.accent }]}
          textStyle={{ fontSize: 16 }}
        />
        <Button variant="secondary" label="Cancel" onPress={onCancel} style={styles.cancelButton} />
      </View>
    </>
  );
}

const STATE_LABEL: Record<string, string> = {
  idle: 'Ready',
  recording: '● Listening',
  thinking: 'Thinking…',
  speaking: '● Speaking',
};

const TALK_BUTTON_LABEL: Record<string, string> = {
  idle: '말하기',
  recording: 'Listening… (pauses when you stop talking)',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

function ConversationPanel({
  conversation,
  onCancel,
}: {
  conversation: ReturnType<typeof useConversationSession>;
  onCancel: () => void;
}) {
  const { state, turns, startTurn, stopTurn } = conversation;
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [turns.length]);

  const onPressTalk = () => {
    if (state === 'idle') startTurn();
    else if (state === 'recording') stopTurn();
  };
  const talkDisabled = state === 'thinking' || state === 'speaking';

  return (
    <>
      <View style={styles.statusRow}>
        <Kicker style={{ color: state === 'idle' ? colors.neutral600 : colors.accent }}>
          {STATE_LABEL[state]}
        </Kicker>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
      >
        {turns.length === 0 ? (
          <Text style={styles.idle}>
            말씀하세요. 잠깐 멈추면 자동으로 전송되고 AI가 대답합니다. 다시 눌러서 직접 끝낼 수도 있어요.
          </Text>
        ) : (
          turns.map((turn, i) => (
            <View key={i}>
              <Kicker style={{ color: colors.neutral600, marginBottom: 4 }}>
                {turn.role === 'user' ? 'You' : 'Mind Record'}
              </Kicker>
              <Text style={styles.turnText}>{turn.content}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <Waveform active={state === 'recording'} />

      <View style={styles.controls}>
        <Button
          label={TALK_BUTTON_LABEL[state]}
          onPress={onPressTalk}
          disabled={talkDisabled}
          align="flex-start"
          style={[styles.micButton, { backgroundColor: state === 'recording' ? colors.neutral900 : colors.accent }]}
          textStyle={{ fontSize: 16 }}
        />
        <Button
          variant="secondary"
          label="Cancel"
          onPress={onCancel}
          disabled={state === 'thinking'}
          style={styles.cancelButton}
        />
      </View>
    </>
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
  turnText: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 23,
    color: colors.text,
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
  cancelButton: {
    minHeight: 64,
    minWidth: 64,
  },
});
