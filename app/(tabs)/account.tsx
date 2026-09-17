import { useFocusEffect } from 'expo-router';
import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, Kicker, RuleThick } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { signOut } from '@/services/auth';
import { getProfile, updateProfile, type Profile } from '@/services/profiles';
import { getAccountStats, type AccountStats } from '@/services/stats';
import { previewVoice } from '@/services/voicePreview';
import { colors, font, radius } from '@/theme';
import type { AiVoice } from '@/types/database';

const VOICE_OPTIONS: { voice: AiVoice; label: string }[] = [
  { voice: 'echo', label: '남성 계열 1' },
  { voice: 'onyx', label: '남성 계열 2' },
  { voice: 'nova', label: '여성 계열 1' },
  { voice: 'shimmer', label: '여성 계열 2' },
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

      <Button
        variant="secondary"
        label={signingOut ? 'Signing out…' : 'Sign out'}
        align="flex-start"
        disabled={signingOut}
        onPress={handleSignOut}
        style={styles.signOut}
      />
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
  const [previewing, setPreviewing] = useState<AiVoice | null>(null);

  const namesDirty = aiName !== (profile.ai_name ?? '') || honorific !== (profile.user_honorific ?? '');

  const saveNames = async () => {
    if (savingNames) return;
    if (aiName.length > 40 || honorific.length > 40) {
      Alert.alert('너무 깁니다', '40자 이하로 입력해 주세요.');
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
      Alert.alert('저장하지 못했습니다', e instanceof Error ? e.message : '다시 시도해 주세요.');
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
      Alert.alert('저장하지 못했습니다', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setSavingVoice(null);
    }
  };

  const playPreview = async (voice: AiVoice) => {
    if (previewing) return;
    setPreviewing(voice);
    try {
      const audioBase64 = await previewVoice(voice, 'ko');
      const file = new File(Paths.cache, `voice-preview-${voice}.mp3`);
      file.write(audioBase64, { encoding: 'base64' });
      const player = createAudioPlayer(file.uri);
      player.play();
    } catch (e) {
      Alert.alert('미리듣기 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setPreviewing(null);
    }
  };

  return (
    <View style={{ marginTop: 18 }}>
      <Kicker style={{ color: colors.neutral600 }}>AI</Kicker>
      <RuleThick style={{ marginTop: 6, marginBottom: 10 }} />

      <Text style={styles.fieldLabel}>AI 이름 (사장님이 AI를 부를 이름)</Text>
      <TextInput
        style={styles.input}
        value={aiName}
        onChangeText={setAiName}
        placeholder="예: Lina (비워두면 그냥 AI)"
        placeholderTextColor={colors.neutral600}
        maxLength={40}
      />

      <Text style={styles.fieldLabel}>나를 부르는 이름</Text>
      <TextInput
        style={styles.input}
        value={honorific}
        onChangeText={setHonorific}
        placeholder="예: Won님 (비워두면 호칭 없음)"
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

      <Text style={styles.fieldLabel}>AI 목소리</Text>
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
                  label={previewing === voice ? '재생 중…' : '미리듣기'}
                  disabled={previewing !== null}
                  onPress={() => playPreview(voice)}
                  style={{ minHeight: 36, paddingHorizontal: 8 }}
                  textStyle={{ fontSize: 12 }}
                />
                <Button
                  variant={selected ? 'primary' : 'secondary'}
                  label={savingVoice === voice ? '...' : selected ? '선택됨' : '선택'}
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
});
