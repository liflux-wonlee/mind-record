import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ArrowUpIcon, CheckIcon, MicIcon, PauseIcon, PlayIcon, StopIcon, XIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { Button, Kicker } from '@/components/ui';
import type { InterruptionReason } from '@/hooks/useAudioInterruption';
import { useCaptureSession } from '@/hooks/useCaptureSession';
import { DEFAULT_SILENCE_DURATION_MS, useConversationSession } from '@/hooks/useConversationSession';
import { dismissToTabs } from '@/nav';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile } from '@/services/profiles';
import { colors, font, radius } from '@/theme';

type ScreenMode = 'capture' | 'conv';

export default function TalkScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();
  // No mode in the params (the plain mic button on Home, or Summary's "New
  // recording" / Search's voice button) -> ask which one before touching
  // the mic at all.
  // Once a mode is picked there is no way back -- switching mid-session
  // would orphan whichever recording already started, so this is a
  // one-time choice rather than a toggle.
  const [mode, setMode] = useState<ScreenMode | null>(
    initialMode === 'conv' ? 'conv' : initialMode === 'capture' ? 'capture' : null
  );
  const [aiName, setAiName] = useState<string | null>(null);
  const [silenceGapMs, setSilenceGapMs] = useState(DEFAULT_SILENCE_DURATION_MS);
  // True only when `mode` arrived pre-set via the URL (a direct link, e.g.
  // Home's "talk with X instead") rather than through the in-screen picker
  // -- picking in the picker starts the mic itself (see pickMode), so this
  // only needs to cover the direct-link case, once.
  const needsAutoStartRef = useRef(initialMode === 'conv' || initialMode === 'capture');

  useEffect(() => {
    if (!user) return;
    getProfile(user.id)
      .then((profile) => {
        setAiName(profile?.ai_name?.trim() || null);
        if (profile?.silence_gap_ms) setSilenceGapMs(profile.silence_gap_ms);
      })
      .catch(() => {
        // The chat label/pause length just fall back to defaults -- not worth blocking the screen over.
      });
  }, [user]);

  const capture = useCaptureSession();
  const conversation = useConversationSession((sessionId) => {
    router.replace(sessionId ? { pathname: '/summary', params: { sessionId } } : '/summary');
  }, silenceGapMs);

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

  // Tapping the mic only pauses/resumes -- it used to also end the whole
  // capture and jump to Summary the moment it stopped, with no visible
  // "saving…" state in between. On a longer recording that upload+end
  // round trip could take a few seconds, and a "Resume" label sitting
  // there tappable the whole time invited exactly what it looks like: tap
  // Resume, record more, tap stop, repeat -- fighting the still-in-flight
  // first attempt and occasionally landing on Summary with nothing
  // actually saved. Finishing is now its own explicit "Done" button.
  const [captureBusy, setCaptureBusy] = useState(false);

  const onToggleRecording = async () => {
    if (captureBusy) return;
    await capture.toggleRecording();
  };

  const onFinishCapture = async () => {
    if (captureBusy) return;
    setCaptureBusy(true);
    try {
      if (capture.recording) {
        await capture.toggleRecording();
      }
      const sessionId = await capture.endCapture();
      router.replace(sessionId ? { pathname: '/summary', params: { sessionId } } : '/summary');
    } finally {
      setCaptureBusy(false);
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
        <CapturePanel
          capture={capture}
          onToggleRecording={onToggleRecording}
          onCancel={onCancelCapture}
          onFinish={onFinishCapture}
          busy={captureBusy || capture.toggleBusy}
        />
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
  onFinish,
  busy,
}: {
  capture: ReturnType<typeof useCaptureSession>;
  onToggleRecording: () => void;
  onCancel: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const { recording, everRecorded, timer, interruption } = capture;
  const statusLabel = busy ? 'Saving…' : recording ? 'Recording' : everRecorded ? 'Paused' : 'Ready';

  return (
    <>
      <View style={styles.hintBox}>
        {interruption && !recording ? (
          <Text style={styles.idle}>
            {INTERRUPTION_TEXT[interruption]} What you said before that is saved. Tap Resume to keep going, or
            Done to finish.
          </Text>
        ) : !everRecorded ? (
          <Text style={styles.idle}>Go ahead and talk. No need to organize it — say everything in one go.</Text>
        ) : null}
      </View>

      <View style={styles.stage}>
        <View style={styles.statusPill}>
          {recording ? <View style={styles.recordingDot} /> : null}
          <Kicker style={recording ? { color: colors.accent700 } : { color: colors.neutral600 }}>
            {statusLabel}
          </Kicker>
        </View>
        <Waveform active={recording} height={90} />
        <Text style={styles.bigTimer}>{timer}</Text>
      </View>

      <View style={styles.circleRow}>
        <CircleButton
          icon={<XIcon size={22} color={colors.text} />}
          label="Cancel"
          onPress={onCancel}
          disabled={busy}
          background={colors.pastelLavender}
        />
        <CircleButton
          icon={<StopIcon size={26} color={colors.bg} />}
          label="Done"
          onPress={onFinish}
          disabled={busy || !everRecorded}
          background={colors.accent700}
          large
        />
        <CircleButton
          icon={
            recording ? (
              <PauseIcon size={22} color={colors.text} />
            ) : (
              <PlayIcon size={22} color={colors.text} />
            )
          }
          label={recording ? 'Pause' : everRecorded ? 'Resume' : 'Start'}
          onPress={onToggleRecording}
          disabled={busy}
          background={recording ? colors.pastelPink : colors.pastelGreen}
        />
      </View>
    </>
  );
}

/** One of the three recording-screen controls -- everyday recorder
 *  metaphor (Cancel / Stop-and-finish / Pause-or-resume) instead of a
 *  single wide "tap to pause" button, so the primary "I'm done" action
 *  has its own unambiguous, always-visible target throughout the whole
 *  recording instead of being folded into the mic button's own label. */
function CircleButton({
  icon,
  label,
  onPress,
  disabled,
  background,
  large,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  background: string;
  large?: boolean;
}) {
  const diameter = large ? 76 : 60;
  return (
    <View style={styles.circleButtonWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.circleButton,
          { width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: background },
          disabled && styles.circleButtonDisabled,
          pressed && !disabled && styles.circleButtonPressed,
        ]}
      >
        {icon}
      </Pressable>
      <Text style={styles.circleButtonLabel}>{label}</Text>
    </View>
  );
}

const INTERRUPTION_TEXT: Record<InterruptionReason, string> = {
  background:
    'Recording paused because the app went to the background (a call, the screen locking, or switching apps). Allow the "Recording" notification when asked and it will keep going next time.',
  'recorder-error': 'Recording stopped because the microphone became unavailable.',
};

// The leading-dot styling (styles.recordingDot, next to this label) is only
// ever shown for 'recording' -- these strings stay plain text so there's
// never a second, text-embedded dot alongside it.
const STATE_LABEL: Record<string, string> = {
  idle: 'Ready',
  recording: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
};

// "Stop" (and a stop-square icon) read as ending the whole conversation --
// the same thing Cancel/Save & end already do -- when this button only
// ever ends the CURRENT turn so the AI can reply; the loop itself keeps
// going right after. "Done talking" plus a send-style arrow reads as
// "hand this turn over" instead.
const TALK_BUTTON_LABEL: Record<string, string> = {
  idle: 'Talk',
  recording: 'Done talking',
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
  const { state, turns, turnBusy, interruption, startTurn, stopTurn } = conversation;
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [turns.length]);

  const onPressTalk = () => {
    if (state === 'idle') startTurn();
    else if (state === 'recording') stopTurn();
  };
  const talkDisabled = state === 'thinking' || state === 'speaking' || turnBusy;
  const endDisabled = state === 'thinking' || turnBusy;

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
      >
        {interruption && state === 'idle' ? (
          <Text style={styles.idle}>
            {INTERRUPTION_TEXT[interruption]} Anything you were mid-way through saying wasn&apos;t sent. Tap Talk to
            continue the conversation, or Save &amp; end to finish.
          </Text>
        ) : null}
        {turns.length === 0 && !interruption ? (
          <Text style={styles.idle}>
            Go ahead and talk. When you pause, the AI replies, and the conversation keeps going on its own. Say
            &quot;save and end&quot; or tap Save &amp; end to finish.
          </Text>
        ) : (
          turns.map((turn, i) => (
            <View key={i}>
              <Kicker style={{ color: colors.neutral600, marginBottom: 4 }}>
                {turn.role === 'user' ? 'You' : aiName ?? 'AI'}
              </Kicker>
              <Text style={styles.turnText}>{turn.content}</Text>
              {turn.actions?.map((label, j) => (
                <View key={j} style={styles.actionChip}>
                  <CheckIcon size={13} color={colors.accent800} />
                  <Text style={styles.actionChipText}>{label}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.stageCompact}>
        <View style={styles.statusPill}>
          {state === 'recording' ? <View style={styles.recordingDot} /> : null}
          <Kicker style={state === 'idle' ? { color: colors.neutral600 } : { color: colors.accent700 }}>
            {STATE_LABEL[state]}
          </Kicker>
        </View>
        <Waveform active={state === 'recording'} height={90} />
      </View>

      <View style={styles.circleRow}>
        <CircleButton
          icon={<XIcon size={22} color={colors.text} />}
          label="Cancel"
          onPress={onCancel}
          disabled={endDisabled}
          background={colors.pastelLavender}
        />
        <CircleButton
          icon={<CheckIcon size={26} color={colors.bg} />}
          label="Save & end"
          onPress={onDone}
          disabled={endDisabled}
          background={colors.accent700}
          large
        />
        <CircleButton
          icon={
            state === 'recording' ? (
              <ArrowUpIcon size={22} color={colors.text} />
            ) : (
              <MicIcon size={22} color={colors.text} />
            )
          }
          label={TALK_BUTTON_LABEL[state]}
          onPress={onPressTalk}
          disabled={talkDisabled}
          background={state === 'recording' ? colors.pastelPink : colors.pastelGreen}
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
      <Text style={styles.pickerTitle}>How do you want to talk?</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPick('conv')}
        style={({ pressed }) => [styles.pickerCard, { backgroundColor: colors.pastelBlue }, pressed && styles.pickerCardPressed]}
      >
        <Text style={styles.pickerCardTitle}>Conversation</Text>
        <Text style={styles.pickerCardDesc}>Back and forth, one turn at a time. Pause and the AI answers.</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPick('capture')}
        style={({ pressed }) => [styles.pickerCard, { backgroundColor: colors.pastelGreen }, pressed && styles.pickerCardPressed]}
      >
        <Text style={styles.pickerCardTitle}>Capture</Text>
        <Text style={styles.pickerCardDesc}>One uninterrupted recording of everything on your mind.</Text>
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
  transcript: {
    flex: 1,
    marginTop: 14,
  },
  transcriptContent: {
    gap: 14,
    paddingBottom: 8,
  },
  // Capture's hint text is 1-2 lines, not a growing list -- unlike
  // Conversation's turn history (styles.transcript, flex: 1), it takes its
  // natural height so the stage below gets the screen's remaining space.
  hintBox: {
    marginTop: 14,
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
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pastel,
    backgroundColor: colors.pastelGreen,
  },
  actionChipText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.text,
  },
  // The centered recording "stage" -- status pill, waveform, and (Capture
  // only) the big timer -- given most of the screen's vertical space so it
  // reads as the primary thing happening, the way a plain recorder app's
  // record screen does, rather than being squeezed between a status row
  // and a wide button.
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  // Conversation's turn history is the primary growing area (styles.
  // transcript already claims flex: 1), so its stage just takes natural
  // height instead of also competing for the remaining space.
  stageCompact: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent700,
  },
  bigTimer: {
    fontFamily: font.extrabold,
    fontSize: 52,
    letterSpacing: 52 * -0.02,
    color: colors.text,
  },
  circleRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    paddingTop: 8,
  },
  circleButtonWrap: {
    alignItems: 'center',
    gap: 8,
  },
  circleButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleButtonDisabled: {
    opacity: 0.4,
  },
  circleButtonPressed: {
    opacity: 0.8,
  },
  circleButtonLabel: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: colors.neutral700,
  },
});
