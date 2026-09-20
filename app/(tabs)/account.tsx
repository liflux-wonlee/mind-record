import { useFocusEffect } from 'expo-router';
import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import {
  biometricLabel,
  disableBiometricLock,
  enableBiometricLock,
  getBiometricSupport,
  isBiometricLockEnabled,
  type BiometricKind,
} from '@/lib/biometricLock';
import { resetOnboarding } from '@/lib/onboarding';
import { deleteAccount } from '@/services/account';
import { signOut } from '@/services/auth';
import {
  connectGoogleTasks,
  disconnectGoogleTasks,
  getGoogleTasksStatus,
  GoogleTasksCancelledError,
  listGoogleTaskLists,
  setDefaultGoogleTaskList,
  type GoogleTaskList,
  type GoogleTasksStatus,
} from '@/services/googleTasks';
import { getProfile, updateProfile, type Profile } from '@/services/profiles';
import { getAccountStats, type AccountStats } from '@/services/stats';
import { previewVoice } from '@/services/voicePreview';
import { colors, font, radius } from '@/theme';
import type { AiVoice } from '@/types/database';

// What language the AI answers in. Speech is always understood in whatever
// language is spoken -- this only steers the reply (and the voice preview).
type Locale = 'auto' | 'ko' | 'en';
const LANGUAGE_OPTIONS: { locale: Locale; label: string; color: string }[] = [
  { locale: 'auto', label: 'Auto', color: colors.pastelYellow },
  { locale: 'ko', label: '한국어', color: colors.pastelGreen },
  { locale: 'en', label: 'English', color: colors.pastelBlue },
];
function localeOf(profile: Profile): Locale {
  return profile.locale === 'ko' || profile.locale === 'en' ? profile.locale : 'auto';
}

const VOICE_OPTIONS: { voice: AiVoice; label: string }[] = [
  { voice: 'echo', label: 'Male voice 1' },
  { voice: 'onyx', label: 'Male voice 2' },
  { voice: 'nova', label: 'Female voice 1' },
  { voice: 'shimmer', label: 'Female voice 2' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function AccountScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);
      Promise.all([getProfile(user.id), getAccountStats(user.id)])
        .then(([p, s]) => {
          if (cancelled) return;
          setProfile(p);
          setStats(s);
        })
        .catch(() => {
          // Leave stats/profile at their previous values; the screen still
          // renders (with the account's email as a fallback name) rather
          // than going blank.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  const displayName = profile?.display_name || user?.email || 'Account';
  const usage = [
    { value: stats ? String(stats.entries) : '—', label: 'Entries', background: colors.pastelYellow },
    { value: stats ? String(stats.days) : '—', label: 'Days', background: colors.pastelGreen },
    { value: stats ? String(stats.topics) : '—', label: 'Topics', background: colors.pastelLavender },
  ];

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // app/_layout.tsx's auth guard redirects to /login once the session clears.
    } catch (e) {
      Alert.alert('Sign out failed', e instanceof Error ? e.message : 'Please try again.');
      setSigningOut(false);
    }
  };

  // Two-step confirm for something this destructive -- a single "are you
  // sure" is too easy to tap through by reflex on a delete this permanent.
  const confirmDeleteAccount = () => {
    if (deleting) return;
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your recordings, transcripts, tasks, ideas, and topics, and your account itself. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: confirmDeleteAccountFinal },
      ]
    );
  };

  const confirmDeleteAccountFinal = () => {
    Alert.alert('Are you absolutely sure?', 'There is no way to recover your account or its data after this.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete my account', style: 'destructive', onPress: handleDeleteAccount },
    ]);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      // deleteAccount() throws (rather than reporting success) unless the
      // server actually confirmed everything was deleted -- never treat a
      // failed/partial attempt as done.
      await deleteAccount();
      await signOut().catch(() => {
        // The account (and its session) is already gone server-side by
        // this point -- signOut() failing here just means it couldn't also
        // clear local storage cleanly, not that the deletion itself failed.
      });
      // app/_layout.tsx's auth guard redirects to /login once the session clears.
    } catch (e) {
      Alert.alert(
        'Could not fully delete your account',
        (e instanceof Error ? e.message : 'Please try again.') + ' No partial deletion was left in place -- your account is safe to keep using, or you can try deleting it again.'
      );
      setDeleting(false);
    }
  };

  return (
    <Screen showAccount={false}>
      <Kicker style={{ color: colors.neutral600 }}>Account</Kicker>

      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(displayName)}</Text>
        </View>
        <View style={styles.flexShrink}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email} numberOfLines={1}>
            {user?.email ?? ''}
          </Text>
        </View>
      </View>

      <View style={styles.usage}>
        {usage.map((stat) => (
          <View key={stat.label} style={[styles.usageCard, { backgroundColor: stat.background }]}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.usageValue}>{stat.value}</Text>
            )}
            <Kicker style={{ color: colors.neutral700, marginTop: 6 }}>{stat.label}</Kicker>
          </View>
        ))}
      </View>

      {user && profile ? (
        <AiSettings userId={user.id} profile={profile} onSaved={setProfile} />
      ) : null}

      {user ? <BiometricSettings userId={user.id} /> : null}

      <GoogleTasksSettings />

      <Button
        variant="secondary"
        label={signingOut ? 'Signing out…' : 'Sign out'}
        align="flex-start"
        disabled={signingOut}
        onPress={handleSignOut}
        style={styles.signOut}
      />
      <Button
        variant="ghost"
        label="Show the intro again"
        align="flex-start"
        onPress={() => {
          resetOnboarding();
        }}
        style={{ marginTop: 8, paddingHorizontal: 0 }}
        textStyle={{ fontSize: 12, color: colors.neutral600 }}
      />

      <View style={styles.dangerZone}>
        <Kicker style={{ color: colors.accent700 }}>Danger zone</Kicker>
        <Text style={styles.dangerText}>
          Deleting your account permanently removes your recordings, transcripts, tasks, ideas, and topics. This
          cannot be undone.
        </Text>
        <Button
          variant="secondary"
          label={deleting ? 'Deleting…' : 'Delete account'}
          align="flex-start"
          disabled={deleting}
          onPress={confirmDeleteAccount}
          style={styles.deleteButton}
          textStyle={{ color: colors.accent700 }}
        />
      </View>
    </Screen>
  );
}

function AiSettings({
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
  const [savingLocale, setSavingLocale] = useState<Locale | null>(null);
  const [previewing, setPreviewing] = useState<AiVoice | null>(null);

  const chooseLocale = async (locale: Locale) => {
    if (savingLocale) return;
    setSavingLocale(locale);
    try {
      const updated = await updateProfile(userId, { locale });
      onSaved(updated);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSavingLocale(null);
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
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
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
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
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
      const audioBase64 = await previewVoice(voice, localeOf(profile));
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
      Alert.alert('Preview failed', e instanceof Error ? e.message : 'Please try again.');
      setPreviewing(null);
    }
  };

  return (
    <View style={{ marginTop: 18 }}>
      <Kicker style={{ color: colors.neutral600 }}>AI</Kicker>
      <RuleThick style={{ marginTop: 6, marginBottom: 10 }} />

      <Text style={styles.fieldLabel}>AI replies in</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
        {LANGUAGE_OPTIONS.map(({ locale, label, color }) => {
          const selected = localeOf(profile) === locale;
          return (
            <Button
              key={locale}
              label={savingLocale === locale ? '...' : label}
              disabled={selected || savingLocale !== null}
              onPress={() => chooseLocale(locale)}
              style={[styles.localeButton, { backgroundColor: color }, selected && styles.localeButtonSelected]}
              textStyle={{ color: colors.text }}
            />
          );
        })}
      </View>
      <Text style={styles.fieldHint}>
        You can always speak in any language — Auto answers in the language you just used.
      </Text>

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
          style={{ marginBottom: 14, minHeight: 40, paddingHorizontal: 16 }}
        />
      ) : (
        <View style={{ marginBottom: 14 }} />
      )}

      <Text style={styles.fieldLabel}>AI voice</Text>
      <View style={{ gap: 8 }}>
        {VOICE_OPTIONS.map(({ voice, label }) => {
          const selected = profile.ai_voice === voice;
          return (
            <View
              key={voice}
              style={[styles.voiceRow, selected && { borderColor: colors.accent, backgroundColor: colors.accent100 }]}
            >
              <Text style={[styles.voiceLabel, selected && { color: colors.accent800 }]}>{label}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  variant="ghost"
                  label={previewing === voice ? 'Playing…' : 'Preview'}
                  disabled={previewing !== null}
                  onPress={() => playPreview(voice)}
                  style={{ minHeight: 36, paddingHorizontal: 8 }}
                  textStyle={{ fontSize: 12 }}
                />
                <Button
                  variant={selected ? 'primary' : 'secondary'}
                  label={savingVoice === voice ? '...' : selected ? 'Selected' : 'Select'}
                  disabled={selected || savingVoice !== null}
                  onPress={() => chooseVoice(voice)}
                  style={{ minHeight: 36, paddingHorizontal: 10 }}
                  textStyle={{ fontSize: 12 }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Off by default; only shown at all when the device actually has a
 * biometric enrolled (rule: "only show what the hardware actually
 * supports"). Turning it on or off both require a real OS auth first --
 * see src/lib/biometricLock.ts -- so this component never flips `enabled`
 * from the toggle press alone, only from what enable/disableBiometricLock
 * actually confirmed.
 */
function BiometricSettings({ userId }: { userId: string }) {
  const [support, setSupport] = useState<{ available: boolean; kind: BiometricKind | null } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBiometricSupport(), isBiometricLockEnabled(userId)]).then(([s, e]) => {
      if (cancelled) return;
      setSupport(s);
      setEnabled(e);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!support?.available) return null;
  const label = biometricLabel(support.kind);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled) {
        const ok = await disableBiometricLock(userId);
        if (ok) setEnabled(false);
        // A cancelled/failed confirmation leaves it on -- disabling must
        // never happen just because the user backed out of the prompt.
      } else {
        const ok = await enableBiometricLock(userId);
        if (ok) {
          setEnabled(true);
        } else {
          Alert.alert('Could not turn on', `${label} did not confirm it was you.`);
        }
      }
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 18 }}>
      <Kicker style={{ color: colors.neutral600 }}>Privacy</Kicker>
      <RuleThick style={{ marginTop: 6, marginBottom: 10 }} />
      <View style={styles.voiceRow}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.voiceLabel}>{label}</Text>
          <Text style={[styles.fieldHint, { marginBottom: 0, marginTop: 2 }]}>
            {enabled
              ? `Your records are locked behind ${label} whenever you open or return to the app.`
              : `Require ${label} to view your records.`}
          </Text>
        </View>
        <Button
          variant={enabled ? 'primary' : 'secondary'}
          label={busy ? '...' : enabled ? 'On' : 'Off'}
          disabled={busy}
          onPress={toggle}
          style={{ minHeight: 36, paddingHorizontal: 14 }}
          textStyle={{ fontSize: 12 }}
        />
      </View>
    </View>
  );
}

/**
 * Available regardless of which provider (Google/Apple/email) the user
 * actually signed into Mind Record with -- this is a completely separate
 * consent/connection (see src/services/googleTasks.ts), never the login
 * token. "Send" (not "sync"): sending a task never links it to keep
 * updating both ways -- see the Tasks screen's own send action for the
 * per-item side of this.
 */
function GoogleTasksSettings() {
  const [status, setStatus] = useState<GoogleTasksStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pickingList, setPickingList] = useState(false);
  const [lists, setLists] = useState<GoogleTaskList[] | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [savingList, setSavingList] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getGoogleTasksStatus()
      .then(setStatus)
      .catch(() => {
        // Leave the section in its previous state rather than showing an
        // error card for what's a secondary, optional settings section.
      });
  }, []);

  useEffect(refresh, [refresh]);

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await connectGoogleTasks();
      refresh();
    } catch (e) {
      if (!(e instanceof GoogleTasksCancelledError)) {
        Alert.alert('Could not connect', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    if (disconnecting) return;
    Alert.alert(
      'Disconnect Google Tasks?',
      'Tasks already sent stay in Google Tasks -- this only stops future sends.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            try {
              await disconnectGoogleTasks();
              setStatus({ connected: false, email: null, defaultListId: null, defaultListTitle: null });
            } catch (e) {
              Alert.alert('Could not disconnect', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ]
    );
  };

  const openListPicker = async () => {
    setPickingList(true);
    setLoadingLists(true);
    try {
      const result = await listGoogleTaskLists();
      setLists(result);
    } catch (e) {
      Alert.alert('Could not load your lists', e instanceof Error ? e.message : 'Please try again.');
      setPickingList(false);
    } finally {
      setLoadingLists(false);
    }
  };

  const chooseList = async (list: GoogleTaskList) => {
    setSavingList(list.id);
    try {
      await setDefaultGoogleTaskList(list.id, list.title);
      setStatus((s) => (s ? { ...s, defaultListId: list.id, defaultListTitle: list.title } : s));
      setPickingList(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSavingList(null);
    }
  };

  if (!status) return null;

  return (
    <View style={{ marginTop: 18 }}>
      <Kicker style={{ color: colors.neutral600 }}>Google Tasks</Kicker>
      <RuleThick style={{ marginTop: 6, marginBottom: 10 }} />
      {status.connected ? (
        <>
          <Text style={styles.fieldHint}>Connected as {status.email}.</Text>
          <View style={styles.voiceRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.voiceLabel}>Default list</Text>
              <Text style={[styles.fieldHint, { marginBottom: 0, marginTop: 2 }]}>
                {status.defaultListTitle ?? 'Not chosen yet'}
              </Text>
            </View>
            <Button
              variant="secondary"
              label="Change"
              onPress={openListPicker}
              style={{ minHeight: 36, paddingHorizontal: 14 }}
              textStyle={{ fontSize: 12 }}
            />
          </View>
          <Button
            variant="ghost"
            label={disconnecting ? 'Disconnecting…' : 'Disconnect'}
            disabled={disconnecting}
            onPress={disconnect}
            align="flex-start"
            style={{ marginTop: 10 }}
            textStyle={{ fontSize: 12, color: colors.accent700 }}
          />
        </>
      ) : (
        <>
          <Text style={styles.fieldHint}>
            Connect a Google account to send tasks to Google Tasks. This never syncs automatically -- you choose
            what to send, from that task&apos;s own menu.
          </Text>
          <Button
            label={connecting ? 'Connecting…' : 'Connect Google Tasks'}
            disabled={connecting}
            onPress={connect}
            align="flex-start"
            style={{ minHeight: 40, paddingHorizontal: 16, marginTop: 6 }}
          />
        </>
      )}

      <BottomSheet visible={pickingList} onClose={() => setPickingList(false)} title="Choose a list">
        {loadingLists ? (
          <ActivityIndicator color={colors.accent} />
        ) : !lists || lists.length === 0 ? (
          <Text style={styles.fieldHint}>No lists found.</Text>
        ) : (
          lists.map((list) => (
            <Button
              key={list.id}
              label={savingList === list.id ? 'Saving…' : list.title}
              align="flex-start"
              variant="secondary"
              disabled={savingList !== null}
              onPress={() => chooseList(list)}
              style={{ marginBottom: 8, borderRadius: radius.pastel }}
            />
          ))
        )}
        <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setPickingList(false)} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  flexShrink: {
    flexShrink: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.pastelPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: colors.accent800,
  },
  name: {
    fontFamily: font.extrabold,
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
  },
  email: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
  },
  usage: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  usageCard: {
    flex: 1,
    borderRadius: radius.pastel,
    padding: 12,
    minHeight: 66,
    justifyContent: 'center',
  },
  usageValue: {
    fontFamily: font.extrabold,
    fontSize: 22,
    lineHeight: 22,
    color: colors.text,
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
    minHeight: 44,
    paddingHorizontal: 12,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: 10,
  },
  fieldHint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral600,
    marginBottom: 14,
  },
  localeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pastel,
    justifyContent: 'center',
  },
  localeButtonSelected: {
    borderWidth: 2,
    borderColor: colors.accent800,
    opacity: 1,
  },
  voiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  voiceLabel: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
  },
  signOut: {
    minHeight: 48,
    marginTop: 20,
    paddingHorizontal: 16,
  },
  dangerZone: {
    marginTop: 28,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  dangerText: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral600,
    marginTop: 6,
    marginBottom: 10,
  },
  deleteButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderColor: colors.accent,
  },
});
