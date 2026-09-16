import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { useRecentSessions } from '@/hooks/useRecentSessions';
import { useTasks } from '@/hooks/useTasks';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile } from '@/services/profiles';
import { listMemoriesCreatedInRange, listMemoriesPendingTopicReview, listRecentMemories } from '@/services/memories';
import { deleteSession, listSessionsForDay, type Session } from '@/services/sessions';
import { listTasks, listTasksCreatedInRange, listTasksPendingTopicReview, type Task } from '@/services/tasks';
import { colors, font, h2 } from '@/theme';

type HomeStats = {
  inboxCount: number;
  openLoopsCount: number;
  todayCount: number;
  todaySessionsCount: number;
};

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const tasksState = useTasks();
  const recentSessions = useRecentSessions(3);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [upcomingTask, setUpcomingTask] = useState<Task | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const startIso = startOfDay.toISOString();
      const endIso = endOfDay.toISOString();

      Promise.all([
        listTasksPendingTopicReview(user.id),
        listMemoriesPendingTopicReview(user.id),
        listRecentMemories(user.id, 50),
        listTasksCreatedInRange(user.id, startIso, endIso),
        listMemoriesCreatedInRange(user.id, startIso, endIso),
        listSessionsForDay(user.id, now),
      ])
        .then(([pendingTasks, pendingMemories, recentMemories, todayTasks, todayMemories, todaySessions]) => {
          if (cancelled) return;
          setStats({
            inboxCount: pendingTasks.length + pendingMemories.length,
            openLoopsCount: recentMemories.length,
            todayCount: todayTasks.length + todayMemories.length,
            todaySessionsCount: todaySessions.length,
          });
        })
        .catch(() => {
          // Leave the stat grid blank rather than crash the screen.
        });

      listTasks(user.id)
        .then((tasks) => {
          if (cancelled) return;
          const withDueDate = tasks
            .filter((t) => t.status === 'open' && t.due_date != null)
            .sort((a, b) => (a.due_date as string).localeCompare(b.due_date as string));
          setUpcomingTask(withDueDate[0] ?? null);
        })
        .catch(() => {
          // Leave "Upcoming" hidden rather than crash the screen.
        });

      return () => {
        cancelled = true;
      };
    }, [user])
  );

  const startTalk = () => {
    router.push({ pathname: '/talk', params: { autoStart: '1' } });
  };

  /** Capture mode is the one-tap default above -- this is the only way to
   *  land on Talk with Conversation mode already selected, since auto-
   *  starting Capture (see app/talk.tsx) locks the mode toggle almost
   *  immediately after landing there. */
  const startConversation = () => {
    router.push({ pathname: '/talk', params: { mode: 'conv' } });
  };

  const confirmDeleteSession = (session: Session) => {
    Alert.alert(
      'Delete this recording?',
      `${session.title ?? session.mode} will be permanently deleted, including its audio. Tasks or ideas it already created are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteSession(session.id)
              .then(() => recentSessions.refresh())
              .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
        },
      ]
    );
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Screen>
      <View style={styles.topRow}>
        <Kicker style={{ color: colors.neutral600 }}>{today}</Kicker>
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
        <Button
          variant="ghost"
          label="Or start a conversation instead"
          onPress={startConversation}
          style={{ minHeight: 36 }}
          textStyle={{ fontSize: 12 }}
        />
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
          value={stats ? String(stats.inboxCount) : '—'}
          sub="needs review"
          side="right"
          bottomRule
          accent
          onPress={() => router.push('/inbox')}
        />
        <Stat
          label="Open loops"
          value={stats ? String(stats.openLoopsCount) : '—'}
          sub="ideas"
          side="left"
          onPress={() => router.push('/memory')}
        />
        <Stat
          label="Today"
          value={stats ? String(stats.todayCount) : '—'}
          sub={stats ? `${stats.todaySessionsCount} session${stats.todaySessionsCount === 1 ? '' : 's'}` : ''}
          side="right"
          onPress={() => router.push('/journal')}
        />
      </View>

      {upcomingTask ? (
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
            <Text style={styles.upcomingTitle} numberOfLines={1}>
              {upcomingTask.title}
            </Text>
            <Text style={styles.upcomingWhen}>
              {new Date(upcomingTask.due_date as string).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>
      ) : null}

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
            <Row
              key={session.id}
              onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
              onLongPress={() => confirmDeleteSession(session)}
              style={styles.continueRow}
            >
              <Text style={styles.continueTitle} numberOfLines={1}>
                {session.title ?? session.mode}
              </Text>
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
    gap: 8,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  continueTitle: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  continueMeta: {
    flexShrink: 0,
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
