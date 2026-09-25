import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronRightIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker } from '@/components/ui';
import { getBiometricSupport, isBiometricLockEnabled } from '@/lib/biometricLock';
import { friendlyMessage } from '@/lib/friendlyError';
import { resetOnboarding } from '@/lib/onboarding';
import { useAuth } from '@/providers/AuthProvider';
import { deleteAccount } from '@/services/account';
import { signOut } from '@/services/auth';
import { getGoogleTasksStatus } from '@/services/googleTasks';
import { getProfile, type Profile } from '@/services/profiles';
import { getAccountStats, type AccountStats } from '@/services/stats';
import { colors, font, radius } from '@/theme';

const MENU_COLORS = [colors.pastelBlue, colors.pastelLavender, colors.pastelGreen, colors.pastelPeach];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

const VOICE_LABELS: Record<string, string> = {
  echo: 'Male voice 1',
  onyx: 'Male voice 2',
  nova: 'Female voice 1',
  shimmer: 'Female voice 2',
  marin: 'Female voice 3 (Marin)',
};

export default function AccountScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [biometricLine, setBiometricLine] = useState('Loading…');
  const [googleTasksLine, setGoogleTasksLine] = useState('Loading…');

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

      Promise.all([getBiometricSupport(), isBiometricLockEnabled(user.id)])
        .then(([support, enabled]) => {
          if (cancelled) return;
          setBiometricLine(!support.available ? 'Not available on this device' : enabled ? 'On' : 'Off');
        })
        .catch(() => {
          if (!cancelled) setBiometricLine('');
        });

      getGoogleTasksStatus()
        .then((status) => {
          if (cancelled) return;
          setGoogleTasksLine(status.connected ? `Connected as ${status.email}` : 'Not connected');
        })
        .catch(() => {
          if (!cancelled) setGoogleTasksLine('');
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

  const aiLine = profile
    ? [profile.ai_name || null, VOICE_LABELS[profile.ai_voice] ?? null].filter(Boolean).join(' · ') ||
      'Default voice'
    : 'Loading…';

  const menuItems = [
    { key: 'ai', title: 'AI', subtitle: aiLine, route: '/settings/ai' as const },
    { key: 'privacy', title: 'Privacy', subtitle: biometricLine, route: '/settings/privacy' as const },
    { key: 'google-tasks', title: 'Google Tasks', subtitle: googleTasksLine, route: '/settings/google-tasks' as const },
    { key: 'legal', title: 'Legal', subtitle: 'Privacy Policy & Terms of Service', route: '/settings/legal' as const },
  ];

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // app/_layout.tsx's auth guard redirects to /login once the session clears.
    } catch (e) {
      Alert.alert('Sign out failed', friendlyMessage(e, 'Please try again.'));
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
        friendlyMessage(e, 'Please try again.') +
          ' No partial deletion was left in place -- your account is safe to keep using, or you can try deleting it again.'
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

      <Kicker style={{ color: colors.neutral600, marginTop: 22, marginBottom: 10 }}>Settings</Kicker>
      <View style={{ gap: 10 }}>
        {menuItems.map((item, i) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => router.push(item.route)}
            style={({ pressed }) => [
              styles.menuRow,
              { backgroundColor: MENU_COLORS[i % MENU_COLORS.length] },
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={styles.flexShrink}>
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuSubtitle} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
            <ChevronRightIcon size={20} color={colors.neutral700} />
          </Pressable>
        ))}
      </View>

      <View style={styles.actionsCard}>
        <Button
          variant="ghost"
          label="Show the intro again"
          align="flex-start"
          onPress={() => {
            resetOnboarding();
          }}
          style={{ paddingHorizontal: 0 }}
          textStyle={{ fontSize: 12, color: colors.neutral600 }}
        />
        <Button
          label={signingOut ? 'Signing out…' : 'Sign out'}
          align="flex-start"
          disabled={signingOut}
          onPress={handleSignOut}
          style={styles.signOut}
        />
      </View>

      <View style={styles.dangerZone}>
        <Kicker style={{ color: colors.accent700 }}>Danger zone</Kicker>
        <Text style={styles.dangerText}>
          Deleting your account permanently removes your recordings, transcripts, tasks, ideas, and topics. This
          cannot be undone.
        </Text>
        <Button
          label={deleting ? 'Deleting…' : 'Delete account'}
          align="flex-start"
          disabled={deleting}
          onPress={confirmDeleteAccount}
          style={styles.deleteButton}
          textStyle={{ color: colors.bg }}
        />
      </View>
    </Screen>
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
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 66,
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuTitle: {
    fontFamily: font.extrabold,
    fontSize: 16,
    color: colors.text,
  },
  menuSubtitle: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral700,
    marginTop: 2,
  },
  actionsCard: {
    marginTop: 22,
    borderRadius: radius.pastel,
    padding: 14,
    backgroundColor: colors.surface,
  },
  signOut: {
    minHeight: 48,
    marginTop: 10,
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
  },
  dangerZone: {
    marginTop: 18,
    borderRadius: radius.pastel,
    padding: 16,
    backgroundColor: colors.pastelPink,
  },
  dangerText: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.accent800,
    marginTop: 6,
    marginBottom: 12,
  },
  deleteButton: {
    minHeight: 46,
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
    backgroundColor: colors.accent700,
    alignSelf: 'flex-start',
  },
});
