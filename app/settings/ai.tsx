import { useFocusEffect } from 'expo-router';
import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SettingsHeader } from '@/components/SettingsHeader';
import { Button, Kicker } from '@/components/ui';
import { DEFAULT_SILENCE_DURATION_MS } from '@/hooks/useConversationSession';
import { friendlyMessage } from '@/lib/friendlyError';
import {
  clearTurnDiagnostics,
  getTurnDetectorChoice,
  setTurnDetectorChoice,
  shareTurnDiagnostics,
  turnDiagnosticsCount,
  type TurnDetectorChoice,
} from '@/lib/turnDiagnostics';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile, updateProfile, type Profile } from '@/services/profiles';
import { previewVoice } from '@/services/voicePreview';
import { colors, font, radius } from '@/theme';
import type { AiVoice } from '@/types/database';

const VOICE_OPTIONS: { voice: AiVoice; label: string; color: string }[] = [
  { voice: 'echo', label: 'Male voice 1', color: colors.pastelBlue },
  { voice: 'onyx', label: 'Male voice 2', color: colors.pastelLavender },
  { voice: 'nova', label: 'Female voice 1', color: colors.pastelPeach },
  { voice: 'shimmer', label: 'Female voice 2', color: colors.pastelPink },
  { voice: 'marin', label: 'Female voice 3 (Marin)', color: colors.pastelGreen },
];

// How long a pause in speech has to last before Conversation mode treats
// the user's turn as over and sends it to the AI -- see
// useConversationSession.ts's silenceGapMs.
const SILENCE_GAP_OPTIONS: { ms: number; label: string; color: string }[] = [
  { ms: 1000, label: 'Quick', color: colors.pastelYellow },
  { ms: 1500, label: 'Normal', color: colors.pastelGreen },
  { ms: 2500, label: 'Relaxed', color: colors.pastelBlue },
];

export default function AiSettingsScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);
      getProfile(user.id)
        .then((p) => {
          if (!cancelled) setProfile(p);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  return (
    <Screen showAccount={false}>
      <SettingsHeader title="AI" />
      {loading && !profile ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : user && profile ? (
        <AiSettingsForm userId={user.id} profile={profile} onSaved={setProfile} />
      ) : null}
    </Screen>
  );
}

function AiSettingsForm({
  userId,
  profile,
  onSaved,
}: {
  userId: string;
  profile: Profile;
  onSaved: (p: Profile) => void;
}) {
  const [aiName, setAiName] = useState(profile.ai_name ?? '');
  const [honorific, setHonorific] = useState(profile.user_honorific ?? '');
  const [savingNames, setSavingNames] = useState(false);
  const [savingVoice, setSavingVoice] = useState<AiVoice | null>(null);
  const [previewing, setPreviewing] = useState<AiVoice | null>(null);
  const [savingSilenceGap, setSavingSilenceGap] = useState<number | null>(null);

  const chooseSilenceGap = async (ms: number) => {
    if (savingSilenceGap !== null) return;
    setSavingSilenceGap(ms);
    try {
      const updated = await updateProfile(userId, { silence_gap_ms: ms });
      onSaved(updated);
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSavingSilenceGap(null);
    }
  };

  const namesDirty = aiName !== (profile.ai_name ?? '') || honorific !== (profile.user_honorific ?? '');

  const saveNames = async () => {
    if (savingNames) return;
    if (aiName.length > 40 || honorific.length > 40) {
      Alert.alert('Too long', 'Please keep it to 40 characters or fewer.');
      return;
    }
    setSavingNames(true);
    try {
      const updated = await updateProfile(userId, {
        ai_name: aiName.trim() || null,
        user_honorific: honorific.trim() || null,
      });
      onSaved(updated);
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSavingNames(false);
    }
  };

  const chooseVoice = async (voice: AiVoice) => {
    if (savingVoice) return;
    setSavingVoice(voice);
    try {
      const updated = await updateProfile(userId, { ai_voice: voice });
      onSaved(updated);
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSavingVoice(null);
    }
  };

  // One player at a time: createAudioPlayer() isn't hook-managed, so each
  // preview used to leak a native player (and two taps overlapped).
  const previewPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const releasePreviewPlayer = () => {
    previewPlayerRef.current?.remove();
    previewPlayerRef.current = null;
  };
  useEffect(() => releasePreviewPlayer, []);

  const playPreview = async (voice: AiVoice) => {
    if (previewing) return;
    setPreviewing(voice);
    try {
      const audioBase64 = await previewVoice(voice);
      const file = new File(Paths.cache, `voice-preview-${voice}.mp3`);
      file.write(audioBase64, { encoding: 'base64' });
      releasePreviewPlayer();
      const player = createAudioPlayer(file.uri);
      previewPlayerRef.current = player;
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish && previewPlayerRef.current === player) {
          releasePreviewPlayer();
          setPreviewing(null);
        }
      });
      player.play();
    } catch (e) {
      Alert.alert('Preview failed', friendlyMessage(e, 'Please try again.'));
      setPreviewing(null);
    }
  };

  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>AI name (what you call the AI)</Text>
        <TextInput
          style={styles.input}
          value={aiName}
          onChangeText={setAiName}
          placeholder="e.g. Lina (leave blank for just AI)"
          placeholderTextColor={colors.neutral600}
          maxLength={40}
        />

        <Text style={styles.fieldLabel}>What the AI calls you</Text>
        <TextInput
          style={styles.input}
          value={honorific}
          onChangeText={setHonorific}
          placeholder="e.g. Won (leave blank for none)"
          placeholderTextColor={colors.neutral600}
          maxLength={40}
        />

        {namesDirty ? (
          <Button
            label={savingNames ? 'Saving…' : 'Save'}
            disabled={savingNames}
            onPress={saveNames}
            align="flex-start"
            variant="save"
            style={{ paddingHorizontal: 16 }}
          />
        ) : null}
      </View>

      <View style={styles.card}>
        <Kicker style={{ color: colors.neutral600, marginBottom: 10 }}>AI voice</Kicker>
        <View style={{ gap: 8 }}>
          {VOICE_OPTIONS.map(({ voice, label, color }) => {
            const selected = profile.ai_voice === voice;
            return (
              <View
                key={voice}
                style={[
                  styles.voiceRow,
                  { backgroundColor: color },
                  selected && { borderWidth: 2, borderColor: colors.accent800 },
                ]}
              >
                <Text style={styles.voiceLabel}>{label}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button
                    variant="ghost"
                    label={previewing === voice ? 'Playing…' : 'Preview'}
                    disabled={previewing !== null}
                    onPress={() => playPreview(voice)}
                    style={{ minHeight: 44, paddingHorizontal: 8 }}
                    textStyle={{ fontSize: 12 }}
                  />
                  <Button
                    variant={selected ? 'primary' : 'secondary'}
                    label={savingVoice === voice ? '...' : selected ? 'Selected' : 'Select'}
                    disabled={selected || savingVoice !== null}
                    onPress={() => chooseVoice(voice)}
                    style={{ minHeight: 44, borderRadius: radius.pastel, paddingHorizontal: 10 }}
                    textStyle={{ fontSize: 12 }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Kicker style={{ color: colors.neutral600, marginBottom: 10 }}>Pause before replying</Kicker>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {SILENCE_GAP_OPTIONS.map(({ ms, label, color }) => {
            const selected = (profile.silence_gap_ms ?? DEFAULT_SILENCE_DURATION_MS) === ms;
            return (
              <Button
                key={ms}
                label={savingSilenceGap === ms ? '...' : label}
                disabled={selected || savingSilenceGap !== null}
                onPress={() => chooseSilenceGap(ms)}
                style={[styles.gapButton, { backgroundColor: color }, selected && styles.gapButtonSelected]}
                textStyle={{ color: colors.text }}
              />
            );
          })}
        </View>
        <Text style={styles.fieldHint}>
          How long a silence in Conversation mode means you're done talking, before the AI replies.
        </Text>
      </View>

      {Platform.OS === 'android' ? <TurnDetectionCard /> : null}
    </View>
  );
}

const DETECTOR_OPTIONS: { choice: TurnDetectorChoice; label: string; color: string }[] = [
  { choice: 'classic', label: 'Previous', color: colors.pastelGreen },
  { choice: 'pcm', label: 'New (testing)', color: colors.pastelBlue },
];

/**
 * Which turn-end detector Conversation mode uses, and the recent turns it
 * keeps on this phone for tuning (see src/lib/turnDiagnostics.ts).
 */
function TurnDetectionCard() {
  const [choice, setChoice] = useState<TurnDetectorChoice | null>(null);
  const [count, setCount] = useState(() => turnDiagnosticsCount());
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    getTurnDetectorChoice().then(setChoice);
  }, []);
  useFocusEffect(
    useCallback(() => {
      setCount(turnDiagnosticsCount());
    }, [])
  );

  const choose = async (next: TurnDetectorChoice) => {
    setChoice(next);
    try {
      await setTurnDetectorChoice(next);
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
    }
  };

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await shareTurnDiagnostics();
    } catch (e) {
      Alert.alert('Could not share', friendlyMessage(e, 'Please try again.'));
    } finally {
      setSharing(false);
    }
  };

  const clear = () => {
    Alert.alert('Delete saved turns?', 'The recordings kept on this phone for tuning are deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            clearTurnDiagnostics();
          } catch {
            // Nothing to delete.
          }
          setCount(0);
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <Kicker style={{ color: colors.neutral600, marginBottom: 10 }}>Turn detection</Kicker>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {DETECTOR_OPTIONS.map(({ choice: c, label, color }) => {
          const selected = choice === c;
          return (
            <Button
              key={c}
              label={label}
              disabled={selected || choice === null}
              onPress={() => choose(c)}
              style={[styles.gapButton, { backgroundColor: color }, selected && styles.gapButtonSelected]}
              textStyle={{ color: colors.text }}
            />
          );
        })}
      </View>
      <Text style={styles.fieldHint}>
        How Conversation mode decides you&apos;ve finished talking. Applies from the next turn.
      </Text>
      <Text style={[styles.fieldHint, { marginTop: 12 }]}>
        The last {count} turn{count === 1 ? '' : 's'} (audio and how the pause was judged) are kept on this phone for
        tuning. Share them to Google Drive when asked.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Button
          variant="secondary"
          label={sharing ? 'Preparing…' : 'Share turns'}
          disabled={sharing || count === 0}
          onPress={share}
          style={{ flex: 1, minHeight: 44, borderRadius: radius.pastel }}
        />
        <Button
          variant="danger"
          label="Delete"
          disabled={count === 0}
          onPress={clear}
          style={{ paddingHorizontal: 14 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
    padding: 16,
    marginBottom: 14,
  },
  fieldLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral600,
    marginBottom: 6,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.pastel,
    marginBottom: 12,
  },
  voiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 54,
    borderRadius: radius.pastel,
    paddingHorizontal: 14,
  },
  voiceLabel: {
    // Wraps instead of pushing the Preview/Select buttons out of the row
    // ("Female voice 3 (Marin)" doesn't fit beside them on a 360dp screen).
    flexShrink: 1,
    marginRight: 8,
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
  },
  gapButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pastel,
    justifyContent: 'center',
  },
  gapButtonSelected: {
    borderWidth: 2,
    borderColor: colors.accent800,
    opacity: 1,
  },
  fieldHint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral600,
  },
});
