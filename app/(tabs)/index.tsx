import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { useRecentSessions } from '@/hooks/useRecentSessions';
import { useTasks } from '@/hooks/useTasks';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile } from '@/services/profiles';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { inboxCount } = useApp();
  const tasksState = useTasks();
  const recentSessions = useRecentSessions(3);
  const [firstName, setFirstName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      getProfile(user.id)
        .then((profile) => {
          if (cancelled) return;
          const name = profile?.display_name?.trim().split(/\s+/)[0];
          setFirstName(name || null);
        })
        .catch(() => {
          // Greeting is a nice-to-have — leave it off rather than block the screen.
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  const startTalk = () => {
    router.push('/talk');
  };

  return (
    <Screen>
      <View style={styles.topRow}>
        <Kicker style={{ color: colors.neutral600 }}>Sat, Sep 12</Kicker>
        <Button
          variant="ghost"
          label="Driving mode"
          onPress={() => router.push('/driving')}
          style={styles.ghostSmall}
          textStyle={styles.uppercaseSmall}
        />
      </View>

      <View style={styles.micBlock}>
        {firstName ? (
          <Kicker style={{ color: colors.neutral600 }}>Hi, {firstName}</Kicker>
        ) : null}
        <Text style={styles.title}>What&apos;s on your mind?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tap to talk"
          onPress={startTalk}
          style={({ pressed }) => [
            styles.mic,
            { backgroundColor: pressed ? colors.accent700 : colors.accent },
          ]}
        >
          <MicIcon size={56} color={colors.bg} />
        </Pressable>
        <Text style={styles.micLabel}>Tap to talk</Text>
      </View>

      <RuleThick style={{ marginTop: 20 }} />
      <View style={styles.grid}>
        <Stat
          label="Tasks"
          value={String(tasksState.openCount)}
          sub="open"
          side="left"
          bottomRule
          onPress={() => router.push('/tasks')}
        />
        <Stat
          label="Inbox"
          value={String(inboxCount)}
          sub="needs review"
          side="right"
          bottomRule
          accent
          onPress={() => router.push('/inbox')}
        />
        <Stat
          label="Open loops"
          value="3"
          sub="pricing 결정 외 2"
          side="left"
          onPress={() => router.push('/memory')}
        />
        <Stat
          label="Today"
          value="7"
          sub="thoughts · 3 ideas"
          side="right"
          onPress={() => router.push('/journal')}
        />
      </View>

      <View style={{ marginTop: 18 }}>
        <View style={styles.sectionHead}>
          <Kicker style={{ color: colors.neutral600 }}>Upcoming</Kicker>
          <Button
            variant="ghost"
            label="Calendar →"
            onPress={() => router.push('/calendar')}
            style={styles.ghostSmall}
            textStyle={{ fontSize: 11, color: colors.accent700 }}
          />
        </View>
        <View style={styles.upcoming}>
          <Text style={styles.upcomingTitle}>David 미팅 — service contract</Text>
          <Text style={styles.upcomingWhen}>Tue 2 PM</Text>
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        <Kicker style={{ color: colors.neutral600, marginBottom: 6 }}>Continue conversation</Kicker>
        <RuleThick />
        {recentSessions.status === 'loading' ? (
          <View style={styles.sessionsCenter}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : recentSessions.status === 'error' ? (
          <Text style={styles.sessionsEmpty}>Couldn&apos;t load recent sessions.</Text>
        ) : recentSessions.sessions.length === 0 ? (
          <Text style={styles.sessionsEmpty}>
            Nothing yet — tap the mic above to start your first session.
          </Text>
        ) : (
          recentSessions.sessions.map((session) => (
            <Row key={session.id} onPress={() => router.push('/topic')} style={styles.continueRow}>
              <Text style={styles.continueTitle}>{session.title ?? session.mode}</Text>
              <Text style={styles.continueMeta}>
                {new Date(session.started_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </Row>
          ))
        )}
      </View>
    </Screen>
  );
}

function Stat({
  label,
  value,
  sub,
  side,
  bottomRule,
  accent,
  onPress,
}: {
  label: string;
  value: string;
  sub: string;
  side: 'left' | 'right';
  bottomRule?: boolean;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Row
      onPress={onPress}
      style={[
        styles.stat,
        side === 'left' ? styles.statLeft : styles.statRight,
        bottomRule && styles.statBottom,
      ]}
    >
      <Kicker style={{ color: colors.neutral600, marginBottom: 2 }}>{label}</Kicker>
      <Text style={[styles.statValue, accent && { color: colors.accent }]}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ghostSmall: {
    minHeight: 44,
    justifyContent: 'center',
  },
  uppercaseSmall: {
    fontSize: 11,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
  },
  micBlock: {
    marginTop: 16,
    alignItems: 'center',
    gap: 20,
  },
  title: {
    ...h2,
    textAlign: 'center',
  },
  mic: {
    width: 148,
    height: 148,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral600,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    width: '50%',
    paddingVertical: 12,
  },
  statLeft: {
    paddingRight: 12,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  statRight: {
    paddingLeft: 12,
  },
  statBottom: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  statValue: {
    fontFamily: font.extrabold,
    fontSize: 30,
    lineHeight: 30,
    color: colors.text,
  },
  statSub: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.neutral700,
    marginTop: 4,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  upcoming: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: 10,
  },
  upcomingTitle: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    flexShrink: 1,
  },
  upcomingWhen: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.neutral700,
  },
  continueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  continueTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  continueMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  sessionsCenter: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  sessionsEmpty: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
  },
});
