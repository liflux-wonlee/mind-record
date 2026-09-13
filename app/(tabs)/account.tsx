import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { ChevronRightIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { prefGroups } from '@/data';
import { useAuth } from '@/providers/AuthProvider';
import { signOut } from '@/services/auth';
import { getProfile, type Profile } from '@/services/profiles';
import { getAccountStats, type AccountStats } from '@/services/stats';
import { useApp } from '@/store';
import { colors, font, radius } from '@/theme';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function AccountScreen() {
  const { user } = useAuth();
  const { prefs, togglePref } = useApp();
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
    <Screen>
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

      {prefGroups.map((group) => (
        <View key={group.name}>
          <Kicker style={{ color: colors.neutral600, marginTop: 18 }}>{group.name}</Kicker>
          <RuleThick style={{ marginTop: 6 }} />
          {group.rows.map((row) => {
            const on = row.kind === 'toggle' ? (prefs[row.key] ?? row.default) : false;
            return (
              <Row
                key={row.label}
                onPress={
                  row.kind === 'toggle' ? () => togglePref(row.key, on) : () => undefined
                }
                style={styles.prefRow}
              >
                <View style={styles.prefLabels}>
                  <Text style={styles.prefLabel}>{row.label}</Text>
                  <Text style={styles.prefSub}>{row.sub}</Text>
                </View>
                {row.kind === 'toggle' ? (
                  <View
                    style={[
                      styles.track,
                      { backgroundColor: on ? colors.accent : colors.neutral300 },
                    ]}
                  >
                    <View style={[styles.knob, { left: on ? 21 : 3 }]} />
                  </View>
                ) : (
                  <View style={styles.prefValue}>
                    <Text style={styles.prefValueText}>{row.value}</Text>
                    <ChevronRightIcon size={16} color={colors.neutral700} />
                  </View>
                )}
              </Row>
            );
          })}
        </View>
      ))}

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
        label="Delete all my data"
        align="flex-start"
        style={styles.deleteData}
        textStyle={{ color: colors.accent700 }}
      />
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
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  prefLabels: {
    flex: 1,
    minWidth: 0,
  },
  prefLabel: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  prefSub: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral700,
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
  },
  knob: {
    position: 'absolute',
    top: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  prefValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  prefValueText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral700,
  },
  signOut: {
    minHeight: 48,
    marginTop: 20,
    paddingHorizontal: 16,
  },
  deleteData: {
    minHeight: 44,
    marginTop: 4,
  },
});
