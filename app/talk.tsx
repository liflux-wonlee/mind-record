import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { Button, Kicker } from '@/components/ui';
import { useCaptureSession } from '@/hooks/useCaptureSession';
import { useConversationSession } from '@/hooks/useConversationSession';
import { dismissToTabs } from '@/nav';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile } from '@/services/profiles';
import { colors, font, radius } from '@/theme';

type ScreenMode = 'capture' | 'conv';

export default function TalkScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();
  // No mode in the params (the plain mic button on Home, or "Keep talking" /
  // Search's voice button) -> ask which one before touching the mic at all.
  // Once a mode is picked there is no way back -- switching mid-session
  // would orphan whichever recording already started, so this is a
  // one-time choice rather than a toggle.
  const [mode, setMode] = useState<ScreenMode | null>(
    initialMode === 'conv' ? 'conv' : initialMode === 'capture' ? 'capture' : null
  );
  const [aiName, setAiName] = useState<string | null>(null);
  // True only when `mode` arrived pre-set via the URL (a direct link, e.g.
  // Home's "talk with X instead") rather than through the in-screen picker
  // -- picking in the picker starts the mic itself (see pickMode), so this
  // only needs to cover the direct-link case, once.
  const needsAutoStartRef = useRef(initialMode === 'conv' || initialMode === 'capture');

  useEffect(() => {
    if (!user) return;
    getProfile(user.id)
      .then((profile) => setAiName(profile?.ai_name?.trim() || null))
      .catch(() => {
        // The chat label just falls back to "AI" -- not worth blocking the screen over.
      });
  }, [user]);

  const capture = useCaptureSession();
  const conversation = useConversationSession((sessionId) => {
    router.replace(sessionId ? { pathname: '/summary', params: { sessionId } } : '/summary');
  });

  const captureStarted = capture.everRecorded;
  const conversationStarted = conversation.turns.length > 0 || conversation.state !== 'idle';

  // Picking a mode in the picker should start talking immediately, not
  // just open that panel and wait for a second tap.
  const pickMode = (picked: ScreenMode) => {
    setMode(picked);
    if (picked === 'capture') {
      capture.toggleRecording();
    } else {
      conversation.startTurn();
    }
  };

  // Covers arriving with a mode already picked via the URL (Home's "talk
  // with X instead" ghost button) -- the picker path above handles itself.
  useEffect(() => {
    if (!needsAutoStartRef.current || mode === null) return;
    needsAutoStartRef.current = false;
    if (mode === 'capture') {
      capture.toggleRecording();
    } else {
      conversation.startTurn();
    }
    // capture/conversation are recreated every render; this must only ever
    // run once, gated by the ref above, so they're deliberately left out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  const onDoneConversation = async () => {
    const sessionId = await conversation.endConversation();
    router.replace(sessionId ? { pathname: '/summary', params: { sessionId } } : '/summary');
  };

  if (mode === null) {
    return (
      <Screen scroll={false} safeBottom showAccount={false}>
        <ModePicker onCancel={dismissToTabs} onPick={pickMode} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} safeBottom showAccount={false}>
      {mode === 'capture' ? (
        <View style={styles.head}>
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
        </View>
      ) : null}

      {mode === 'capture' ? (
        <CapturePanel capture={capture} onToggleRecording={onToggleRecording} onCancel={onCancelCapture} />
      ) : (
        <ConversationPanel
          conversation={conversation}
          onCancel={onCancelConversation}
          onDone={onDoneConversation}
          aiName={aiName}
        />
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
          style={[styles.micButton, { backgroundColor: recording ? colors.pastelPink : colors.pastelGreen }]}
          textStyle={[styles.pastelButtonText, { fontSize: 16 }]}
        />
        <Button
          label="Cancel"
          onPress={onCancel}
          style={[styles.cancelButton, { backgroundColor: colors.pastelLavender }]}
          textStyle={styles.pastelButtonText}
        />
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
  recording: 'Listening… tap to stop',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

function ConversationPanel({
  conversation,
  onCancel,
  onDone,
  aiName,
}: {
  conversation: ReturnType<typeof useConversationSession>;
  onCancel: () => void;
  onDone: () => void;
  aiName: string | null;
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
  const talkButtonColor =
    state === 'recording' ? colors.pastelPink : state === 'idle' ? colors.pastelGreen : colors.pastelYellow;

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
            말씀하세요. 잠깐 멈추면 AI가 대답하고, 이후엔 자동으로 계속 대화가 이어집니다. &quot;저장하고
            끝내&quot;라고 말하거나 Cancel을 눌러 마칠 수 있어요.
          </Text>
        ) : (
          turns.map((turn, i) => (
            <View key={i}>
              <Kicker style={{ color: colors.neutral600, marginBottom: 4 }}>
                {turn.role === 'user' ? 'You' : aiName ?? 'AI'}
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
          style={[styles.micButton, { backgroundColor: talkButtonColor }]}
          textStyle={[styles.pastelButtonText, { fontSize: 16 }]}
        />
      </View>
      <View style={[styles.controls, { marginTop: 8 }]}>
        <Button
          label="Cancel"
          onPress={onCancel}
          disabled={state === 'thinking'}
          style={{ flex: 1, minHeight: 52, borderRadius: radius.pastel, backgroundColor: colors.pastelLavender }}
          textStyle={styles.pastelButtonText}
        />
        <Button
          label="Save & end"
          onPress={onDone}
          disabled={state === 'thinking'}
          style={{ flex: 1, minHeight: 52, borderRadius: radius.pastel, backgroundColor: colors.pastelBlue }}
          textStyle={styles.pastelButtonText}
        />
      </View>
    </>
  );
}

function ModePicker({
  onPick,
  onCancel,
}: {
  onPick: (mode: ScreenMode) => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.pickerWrap}>
      <Text style={styles.pickerTitle}>어떻게 이야기할까요?</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPick('conv')}
        style={({ pressed }) => [styles.pickerCard, { backgroundColor: colors.pastelBlue }, pressed && styles.pickerCardPressed]}
      >
        <Text style={styles.pickerCardTitle}>Conversation</Text>
        <Text style={styles.pickerCardDesc}>한 마디씩 주고받아요. 말을 멈추면 AI가 바로 답해요.</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPick('capture')}
        style={({ pressed }) => [styles.pickerCard, { backgroundColor: colors.pastelGreen }, pressed && styles.pickerCardPressed]}
      >
        <Text style={styles.pickerCardTitle}>Capture</Text>
        <Text style={styles.pickerCardDesc}>끊기지 않고 하고 싶은 말을 쭉 녹음해요.</Text>
      </Pressable>
      <Button variant="ghost" label="Cancel" align="flex-start" onPress={onCancel} style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  pickerWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
  },
  pickerTitle: {
    fontFamily: font.extrabold,
    fontSize: 22,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  pickerCard: {
    borderRadius: radius.pastel,
    padding: 20,
    gap: 6,
  },
  pickerCardPressed: {
    opacity: 0.8,
  },
  pickerCardTitle: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: colors.text,
  },
  pickerCardDesc: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral700,
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
    borderRadius: radius.pastel,
  },
  cancelButton: {
    minHeight: 64,
    minWidth: 64,
    borderRadius: radius.pastel,
  },
  pastelButtonText: {
    color: colors.text,
  },
});
